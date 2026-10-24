#!/usr/bin/env node
/**
 * PGlite proof for 20261023232151_paypal_job_checkout (PayPal Plan A, phase 3), on top of
 * 20261023223419_paypal_provider_foundation (phase 1).
 *
 *   node src/test/pglite/paypalJobCheckout.pglite.mjs
 *   PLANT=legacy_award_gate node src/test/pglite/paypalJobCheckout.pglite.mjs   # RED: award on an uncaptured PayPal job
 *   PLANT=no_claim_checks   node src/test/pglite/paypalJobCheckout.pglite.mjs   # RED: a re-priced / closed order is captured
 *   PLANT=no_price_lock     node src/test/pglite/paypalJobCheckout.pglite.mjs   # RED: the poster re-prices mid-capture
 *   PLANT=legacy_job_is_funded node src/test/pglite/paypalJobCheckout.pglite.mjs # RED: a pending PayPal capture reads funded
 *   PLANT=no_record_recheck node src/test/pglite/paypalJobCheckout.pglite.mjs   # RED: a capture lands on a job closed under it
 *   PLANT=no_money_guard   node src/test/pglite/paypalJobCheckout.pglite.mjs   # RED: a Stripe-era write marks PayPal money released
 *   PLANT=fee_on_dup       node src/test/pglite/paypalJobCheckout.pglite.mjs   # RED: a duplicate setup fee is recorded on the job
 *   PLANT=flag_null_unsafe node src/test/pglite/paypalJobCheckout.pglite.mjs   # RED: an unset sanctioned-cancel flag lets every member cancel through
 *   PLANT=no_fee_once      node src/test/pglite/paypalJobCheckout.pglite.mjs    # RED: the setup fee is taken twice
 *   PLANT=legacy_jobs_change node src/test/pglite/paypalJobCheckout.pglite.mjs   # RED: a Stripe-era job's answer changes
 *
 * Proves: both migrations apply 3x (and once more after an admin flips the switch); the
 * paypal_payments switch refuses a new order for a member it is off for (even via the service
 * role) and a capture once it is turned off; members and the anon key cannot call any of the
 * RPCs; an order is recorded only for the poster, on an open unfunded job, at the price it was
 * made for; a double-tap gets the same row; one open order per job; only an unapproved order
 * is voided; a capture is claimed only while the job still has that price and is still open;
 * the price is locked while a capture is in flight; a pending capture funds nothing; a settled
 * capture funds the job once (replayed 3x = one funding); a capture on a retired order or a
 * second capture is reported, never funds; a declined capture marks the job failed; the
 * one-time setup fee is collected once; and the award gate refuses a PayPal job until its
 * money is captured while legacy jobs keep their rule.
 *
 * Prod-shaped stubs: is_server_context, has_role, feature_enabled_for_user and
 * job_payment_is_funded are prod's definitions (pg_get_functiondef, 2026-10-23); the jobs
 * table carries only the columns these functions read, with prod's types (information_schema,
 * 2026-10-23: category job_category enum, status job_status enum, recurrence_days smallint[]).
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const p1 = read("20261023223419_paypal_provider_foundation.sql");
let p3 = read("20261023232151_paypal_job_checkout.sql");
const plant = (find, repl) => {
  if (!p3.includes(find)) throw new Error(`plant target missing: ${find.slice(0, 60)}`);
  p3 = p3.replace(find, repl);
};
if (process.env.PLANT === "legacy_award_gate") plant("IF NOT (public.job_payment_is_funded(NEW.payment_status) AND public.job_provider_payment_held(NEW.id)) THEN", "IF NOT public.job_payment_is_funded(NEW.payment_status) THEN");
if (process.env.PLANT === "legacy_job_is_funded") plant("SELECT public.job_payment_is_funded(j.payment_status) AND public.job_provider_payment_held(j.id)", "SELECT public.job_payment_is_funded(j.payment_status)");
if (process.env.PLANT === "legacy_jobs_change") plant("    OR NOT EXISTS (SELECT 1 FROM public.provider_payments p\n                    WHERE p.subject_kind = 'job' AND p.subject_id = p_job_id", "    OR false AND NOT EXISTS (SELECT 1 FROM public.provider_payments p\n                    WHERE p.subject_kind = 'job' AND p.subject_id = p_job_id");
if (process.env.PLANT === "no_claim_checks") plant("  IF v_reason IS NOT NULL THEN\n    -- A created order is voided", "  IF false THEN\n    -- A created order is voided");
if (process.env.PLANT === "no_price_lock") plant("CREATE TRIGGER trg_paypal_capture_locks_job_price\n  BEFORE UPDATE OR DELETE ON public.jobs", "CREATE TRIGGER trg_paypal_capture_locks_job_price\n  BEFORE INSERT ON public.jobs");
if (process.env.PLANT === "no_record_recheck") plant("    ELSIF v_job.status::text IN ('completed', 'cancelled') THEN\n      v_why := 'orphan:job_closed';", "    ELSIF false THEN\n      v_why := 'orphan:job_closed';");
if (process.env.PLANT === "no_money_guard") plant("CREATE TRIGGER trg_paypal_job_money_state_guard\n  BEFORE UPDATE OF payment_status ON public.jobs", "CREATE TRIGGER trg_paypal_job_money_state_guard\n  BEFORE INSERT ON public.jobs");
if (process.env.PLANT === "fee_on_dup") plant("onboarding_fee_amount = CASE WHEN v_fee_rows = 1 THEN", "onboarding_fee_amount = CASE WHEN v_onboarding > 0 THEN");
if (process.env.PLANT === "flag_null_unsafe") { plant("AND current_setting('app.paypal_sanctioned_cancel', true) IS DISTINCT FROM '1'", "AND NOT (current_setting('app.paypal_sanctioned_cancel', true) = '1')"); }
if (process.env.PLANT === "no_fee_once") plant("      v_reason := 'setup_fee_already_paid';", "      v_reason := NULL;");

const U = {
  ordinary: "11111111-1111-4111-8111-111111111111",
  tester: "22222222-2222-4222-8222-222222222222",
  admin: "33333333-3333-4333-8333-333333333333",
  helpr: "44444444-4444-4444-8444-444444444444",
};
const FIXTURE = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create type public.app_role as enum ('admin','customer','helper');
create type public.job_status as enum ('open','accepted','in_progress','revision_requested','completed','cancelled','disputed');
create type public.job_category as enum ('cleaning','assembly','moving','other');
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
CREATE OR REPLACE FUNCTION public.feature_enabled_for_user(p_key text, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT CASE s.audience
             WHEN 'everyone' THEN true
             WHEN 'testers' THEN
               COALESCE(public.has_role(p_user_id, 'admin'::app_role), false)
               OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id)
             ELSE false
           END
      FROM public.feature_switches s
     WHERE s.key = p_key AND p_user_id IS NOT NULL
  ), false);
$function$;
REVOKE ALL ON FUNCTION public.feature_enabled_for_user(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feature_enabled_for_user(text, uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.job_payment_is_funded(p_payment_status text)
 RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(p_payment_status, '') = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]);
$function$;
create table public.payout_transfers(id uuid primary key default gen_random_uuid());
create table public.profiles(user_id uuid primary key, onboarding_fee_paid boolean default false);
create table public.jobs(
  id uuid primary key, customer_id uuid, helper_id uuid, helper_confirmed_at timestamptz,
  status public.job_status not null default 'open', payment_status text default 'unpaid',
  budget numeric, urgent_fee numeric, is_urgent boolean default false, category public.job_category not null default 'other',
  helpers_needed int, is_group_job boolean default false, recurrence_days smallint[],
  sales_tax_amount numeric default 0, sales_tax_rate numeric default 0, stripe_payment_intent_id text, onboarding_fee_amount numeric);
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
grant select on public.feature_switches, public.test_accounts, public.user_roles to service_role;
grant select, update, delete on public.jobs to authenticated;
grant select, insert, update on public.jobs, public.profiles to service_role;
insert into auth.users values ('${U.ordinary}'), ('${U.tester}'), ('${U.admin}'), ('${U.helpr}');
insert into public.test_accounts(user_id) values ('${U.tester}');
insert into public.user_roles values ('${U.admin}', 'admin');
insert into public.profiles(user_id, onboarding_fee_paid) values ('${U.tester}', false), ('${U.ordinary}', false);
-- the award gate's trigger, as prod has it (trg_job_funded_before_award)
`;
const db = new PGlite();
await db.exec(FIXTURE);
const r = {};
const expectErr = async (label, sql, re) => {
  try { await db.query(sql); r[label] = "bad: allowed"; } catch (e) { r[label] = re.test(e.message) ? "ok" : `wrong: ${e.message}`; }
};
const expectOk = async (label, sql) => {
  try { await db.query(sql); r[label] = "ok"; } catch (e) { r[label] = `bad: ${e.message}`; }
};
const one = async (sql) => (await db.query(sql)).rows[0];
const val = async (sql) => Object.values((await db.query(sql)).rows[0] ?? {})[0];

for (let i = 1; i <= 3; i++) { await db.exec(p1); await db.exec(p3); }
r.applied3x = "ok";
await db.exec("CREATE TRIGGER trg_job_funded_before_award BEFORE INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_job_funded_before_award()");

const J = (n) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const job = (n, extra = {}) => {
  const row = { id: J(n), customer_id: U.tester, budget: 100, urgent_fee: 0, is_urgent: false, category: "cleaning", helpers_needed: null, ...extra };
  const cols = Object.keys(row);
  return `insert into jobs(${cols.join(",")}) values (${cols.map((c) => row[c] === null ? "null" : typeof row[c] === "string" ? `'${row[c]}'` : row[c]).join(",")})`;
};
const bd = (o = {}) => JSON.stringify({ budget: 100, urgent_fee: 0, is_urgent: false, category: "cleaning", helpers_needed: null, recurrence_days: null, job_price_cents: 10000, onboarding_fee_cents: 0, item_cents: 10000, tax_cents: 0, taxable_base_cents: 0, helper_fee_percent: 8, helper_fee_flat_cents: 70, ...o });
const open = (n, payer, key, order, amount = 10000, b = bd()) =>
  `select public.paypal_job_order_open('${J(n)}', '${payer}', '${key}', '${order}', ${amount}, 'sandbox', '${b}'::jsonb) j`;
const pid = async (key) => (await one(`select id from provider_payments where idempotency_key='${key}'`))?.id;
const claim = async (key) => (await one(`select public.paypal_job_capture_claim('${await pid(key)}') j`)).j;
const rec = async (key, cap, amount = 10000, settled = true) => {
  try { return (await one(`select public.paypal_job_capture_record('${await pid(key)}', '${cap}', ${amount}, ${settled}, 30) j`)).j; }
  catch (e) { return { outcome: `error: ${e.message}` }; }
};
const asMember = async (uid) => { await db.exec(`set role authenticated; set request.jwt.claim.sub = '${uid}'; set request.jwt.claim.role = 'authenticated'`); };
const asServer = async () => { await db.exec(`reset role; reset request.jwt.claim.sub; reset request.jwt.claim.role; set role service_role`); };

await db.exec(job(1)); await db.exec(job(2)); await db.exec(job(3)); await db.exec(job(4)); await db.exec(job(5));
await db.exec(job(6, { customer_id: U.ordinary })); await db.exec(job(7)); await db.exec(job(8)); await db.exec(job(9));

// --- switch OFF (as created): nobody can open an order, even through the service role
await asServer();
await expectErr("off: no order for a tester", open(1, U.tester, "k-off", "OOFF"), /feature_disabled/);
await db.exec("reset role");
await db.exec("update feature_switches set audience='testers' where key='paypal_payments'");
await db.exec(p1); await db.exec(p3);
r.replayKeepsFlip = (await val("select audience from feature_switches where key='paypal_payments'")) === "testers" ? "ok" : "bad";

// --- members and anon cannot call the RPCs
const RPCS = [
  ["paypal_job_payment_state", `'${J(1)}'`], ["paypal_job_payment_by_order", "'X'"], ["paypal_payment_subject_by_order", "'X'"],
  ["paypal_job_order_open", `'${J(1)}', '${U.tester}', 'kx', 'OX', 10000, 'sandbox', '{}'::jsonb`],
  ["paypal_job_order_void", `'${J(1)}', 'x'`], ["paypal_job_capture_claim", `'${J(1)}'`],
  ["paypal_job_capture_record", `'${J(1)}', 'C1', 1, true, 30`], ["paypal_job_capture_failed", `'${J(1)}', 'x'`],
  ["job_provider_payment_held", `'${J(1)}'`],
];
for (const role of ["authenticated", "anon"]) {
  if (role === "authenticated") await asMember(U.tester); else await db.exec("reset role; set role anon");
  for (const [fn, args] of RPCS) await expectErr(`${role} cannot call ${fn}`, `select public.${fn}(${args})`, /permission denied/);
  await db.exec("reset role");
}
for (const [fn] of RPCS) {
  const acl = await val(`select proacl::text from pg_proc where proname='${fn}'`);
  r[`${fn} acl`] = /service_role=X/.test(acl ?? "") && !/(^|[{,])=X|anon=X|authenticated=X/.test(acl ?? "") ? "ok" : `bad (${acl})`;
}

await asServer();
// --- opening an order
await expectErr("testers: an ordinary member's order is refused", open(6, U.ordinary, "k-ord", "OORD"), /feature_disabled/);
await expectErr("only the poster pays", open(1, U.admin, "k-adm", "OADM"), /not_the_poster/);
await expectErr("the order total must be item + tax", open(1, U.tester, "k-amt", "OAMT", 9999), /amount_not_item_plus_tax/);
await expectErr("an order made for another price is refused", open(1, U.tester, "k-pr", "OPR", 12000, bd({ budget: 120, job_price_cents: 12000, item_cents: 12000 })), /price_changed/);
await expectOk("the poster opens an order", open(1, U.tester, "k1a", "O1A"));
const again = (await one(open(1, U.tester, "k1a", "O1A"))).j;
r["a double-tap (same key) gets the same row"] = again.id === (await pid("k1a")) ? "ok" : "bad";
await expectErr("a reused key naming a different order is refused", open(1, U.tester, "k1a", "O1Z"), /idempotency_key_reused/);
await expectErr("one open order per job", open(1, U.tester, "k1b", "O1B"), /one_open_per_subject/);
const st = (await one(`select public.paypal_job_payment_state('${J(1)}') j`)).j;
r["state: attempts and current"] = st.attempts === 1 && st.current?.provider_order_id === "O1A" ? "ok" : `bad ${JSON.stringify(st)}`;
r["subject by order id"] = (await val(`select public.paypal_payment_subject_by_order('O1A')`)) === "job" && (await val(`select public.paypal_payment_subject_by_order('NOPE')`)) === null ? "ok" : "bad";
r["by order id"] = (await one(`select public.paypal_job_payment_by_order('O1A') j`)).j?.idempotency_key === "k1a" ? "ok" : "bad";

// --- price lock: free while only created, locked once claimed
await asMember(U.tester);
await expectOk("poster may re-price while the order is only created", `update jobs set budget = 110 where id='${J(1)}'`);
await expectOk("(and back)", `update jobs set budget = 100 where id='${J(1)}'`);
await asServer();

// --- claim
r["claim: ok"] = (await claim("k1a")).ok === true ? "ok" : "bad";
r["claim: re-entry ok (retry)"] = (await claim("k1a")).reason === "already_claimed" ? "ok" : "bad";
r["a claimed order is not voided (capture in flight)"] = (await val(`select public.paypal_job_order_void('${await pid("k1a")}', 'x')`)) === false ? "ok" : "bad";
await asMember(U.tester);
await expectErr("poster cannot re-price while a capture is in flight", `update jobs set budget = 150 where id='${J(1)}'`, /paypal_payment_in_progress/);
await expectErr("nor the urgent bonus", `update jobs set urgent_fee = 20, is_urgent = true where id='${J(1)}'`, /paypal_payment_in_progress/);
await asServer();

// --- award gate before capture
await asMember(U.tester);
await expectErr("award refused without a capture", `update jobs set helper_id='${U.helpr}' where id='${J(1)}'`, /not funded yet/);
await asServer();

// --- record: pending funds nothing; settled funds once
r["record: wrong amount"] = (await rec("k1a", "CAP1", 9000)).outcome === "amount_mismatch" ? "ok" : "bad";
r["record: pending capture"] = (await rec("k1a", "CAP1", 10000, false)).outcome === "pending" ? "ok" : "bad";
r["pending funds nothing"] = (await val(`select payment_status from jobs where id='${J(1)}'`)) === "unpaid" ? "ok" : "bad";
await db.exec("reset role");
await expectErr("a stray server write cannot mark a capture-pending PayPal job funded", `update jobs set payment_status='escrow' where id='${J(1)}'`, /paypal_job_money_outside_paypal/);
// ...and even a write that claims to be PayPal's leaves the award gate refusing a pending capture:
await db.exec(`select set_config('app.paypal_money_write', '1', false); update jobs set payment_status='escrow' where id='${J(1)}'; select set_config('app.paypal_money_write', '', false)`);
await asMember(U.tester);
await expectErr("award refused while the capture is pending, whatever payment_status says", `update jobs set helper_id='${U.helpr}' where id='${J(1)}'`, /not funded yet/);
await db.exec("reset role");
await db.exec(`select set_config('app.paypal_money_write', '1', false); update jobs set payment_status='unpaid' where id='${J(1)}'; select set_config('app.paypal_money_write', '', false)`);
await asServer();
r["record: another capture id is refused"] = (await rec("k1a", "CAPX")).outcome === "capture_id_mismatch" ? "ok" : "bad";
r["record: settled -> funded"] = (await rec("k1a", "CAP1")).outcome === "funded" ? "ok" : "bad";
const replays = [await rec("k1a", "CAP1"), await rec("k1a", "CAP1"), await rec("k1a", "CAP1")].map((x) => x.outcome);
r["replayed 3x = already_funded, one funding"] = replays.every((o) => o === "already_funded") ? "ok" : `bad ${replays}`;
r["PayPal's fee kept on the captured row"] = Number(await val(`select breakdown->>'paypal_fee_cents' from provider_payments where idempotency_key='k1a'`)) === 30 ? "ok" : "bad";
r["job is escrow"] = (await val(`select payment_status from jobs where id='${J(1)}'`)) === "escrow" ? "ok" : "bad";
r["one captured row"] = Number(await val(`select count(*) from provider_payments where subject_id='${J(1)}' and status='captured'`)) === 1 ? "ok" : "bad";
await asMember(U.tester);
await expectOk("award allowed once captured", `update jobs set helper_id='${U.helpr}' where id='${J(1)}'`);
await asServer();

// --- claim refusals void the order
await expectOk("job 2 order", open(2, U.tester, "k2a", "O2A"));
await db.exec("reset role"); await db.exec(`update jobs set budget = 130 where id='${J(2)}'`); await asServer();
const c2 = await claim("k2a");
r["claim: price changed -> refused and voided"] = c2.ok === false && c2.reason === "price_changed" && (await val(`select status from provider_payments where idempotency_key='k2a'`)) === "voided" ? "ok" : `bad ${JSON.stringify(c2)}`;
r["record on a voided order: orphan, funds nothing"] = (await rec("k2a", "CAP2")).outcome === "orphan" && (await val(`select payment_status from jobs where id='${J(2)}'`)) === "unpaid" ? "ok" : "bad";
await expectOk("job 3 order", open(3, U.tester, "k3a", "O3A"));
await db.exec("reset role"); await db.exec(`update jobs set status='cancelled' where id='${J(3)}'`); await asServer();
r["claim: closed job -> refused"] = (await claim("k3a")).reason === "job_closed" ? "ok" : "bad";
await expectOk("job 4 order", open(4, U.tester, "k4a", "O4A"));
r["record of an unclaimed order: orphan (voided, capture kept, reason)"] = (await rec("k4a", "CAP4")).outcome === "orphan"
  && JSON.stringify(await one(`select status, provider_capture_id, status_reason from provider_payments where idempotency_key='k4a'`)) === JSON.stringify({ status: "voided", provider_capture_id: "CAP4", status_reason: "orphan:unclaimed" }) ? "ok" : "bad";
r["an orphan is reported again on every record, never funds"] = (await rec("k4a", "CAP4")).outcome === "orphan" && (await val(`select payment_status from jobs where id='${J(4)}'`)) === "unpaid" ? "ok" : "bad";
await expectOk("re-mint after the orphan: attempt 2", open(4, U.tester, "k4b", "O4B"));
r["void of a created order"] = (await val(`select public.paypal_job_order_void('${await pid("k4b")}', 'replaced')`)) === true ? "ok" : "bad";
await expectOk("re-mint again: attempt 3", open(4, U.tester, "k4c", "O4C"));
r["state counts voided attempts"] = (await one(`select public.paypal_job_payment_state('${J(4)}') j`)).j.attempts === 3 ? "ok" : "bad";

// --- declined capture
await expectOk("job 5 order", open(5, U.tester, "k5a", "O5A"));
await claim("k5a");
r["declined -> failed, job failed"] = (await val(`select public.paypal_job_capture_failed('${await pid("k5a")}', 'INSTRUMENT_DECLINED')`)) === true
  && (await val(`select payment_status from jobs where id='${J(5)}'`)) === "failed" ? "ok" : "bad";
await expectOk("a failed job can be paid again", open(5, U.tester, "k5b", "O5B"));

// --- the switch turned off after the order: no capture
await expectOk("job 7 order", open(7, U.tester, "k7a", "O7A"));
await db.exec("reset role"); await db.exec("update feature_switches set audience='off' where key='paypal_payments'"); await asServer();
const c7 = await claim("k7a");
r["claim refused once the switch is off (not voided)"] = c7.reason === "feature_disabled" && (await val(`select status from provider_payments where idempotency_key='k7a'`)) === "created" ? "ok" : "bad";
await db.exec("reset role"); await db.exec("update feature_switches set audience='testers' where key='paypal_payments'"); await asServer();

// --- second capture for a funded job; setup fee once
await expectOk("job 8 order (with the setup fee)", open(8, U.tester, "k8a", "O8A", 10200, bd({ onboarding_fee_cents: 200, item_cents: 10200 })));
await claim("k8a");
const f8 = await rec("k8a", "CAP8", 10200);
r["setup fee collected"] = f8.outcome === "funded" && f8.onboarding_fee_duplicate === false && (await val(`select onboarding_fee_paid from profiles where user_id='${U.tester}'`)) === true ? "ok" : `bad ${JSON.stringify(f8)}`;
await expectOk("job 9 order (carries the setup fee again)", open(9, U.tester, "k9a", "O9A", 10200, bd({ onboarding_fee_cents: 200, item_cents: 10200 })));
const c9 = await claim("k9a");
r["an order carrying a setup fee already paid is refused at the claim (and voided)"] = c9.ok === false && c9.reason === "setup_fee_already_paid"
  && (await val(`select status from provider_payments where idempotency_key='k9a'`)) === "voided" ? "ok" : `bad ${JSON.stringify(c9)}`;
await db.exec("reset role");
await db.exec(`insert into provider_payments(subject_kind, subject_id, payer_id, provider, env, idempotency_key, provider_order_id, amount_cents, status, breakdown) values ('job', '${J(8)}', '${U.tester}', 'paypal_checkout', 'sandbox', 'k8z', 'O8Z', 10000, 'approved', '${bd()}')`);
await asServer();
r["second capture on a funded job: orphan, never funds"] = (await rec("k8z", "CAP8Z")).outcome === "orphan" ? "ok" : "bad";

// --- review fixes (lh-authz-rls #1, lh-money-escrow #2-#4, lh-silent-failure #2)
await db.exec("reset role");
await db.exec(`${job(30)}; ${job(31)}; ${job(32)}; ${job(33)}; ${job(34)}; ${job(35)}`.split(";").map((x) => x.trim()).filter(Boolean).join(";"));
await db.exec(`update profiles set onboarding_fee_paid=false where user_id='${U.tester}'`);
await asServer();
await expectOk("job 30 order", open(30, U.tester, "k30", "O30"));
await asMember(U.tester);
await expectOk("poster may delete a job whose order is only created", `delete from jobs where id='${J(30)}'`);
await asServer();
await expectOk("job 31 order", open(31, U.tester, "k31", "O31"));
await claim("k31");
await asMember(U.tester);
await expectErr("poster cannot delete a job mid-capture", `delete from jobs where id='${J(31)}'`, /paypal_payment_in_progress/);
await expectErr("nor cancel it", `update jobs set status='cancelled' where id='${J(31)}'`, /paypal_payment_in_progress/);
await asServer();
await expectErr("a NULL 'settled' never funds", `select public.paypal_job_capture_record('${await pid("k31")}', 'CAP31', 10000, null, 30)`, /capture_settled_unknown/);
await db.exec("reset role"); await db.exec(`update jobs set status='cancelled' where id='${J(31)}'`); await asServer(); // a server close under the capture
const r31 = await rec("k31", "CAP31");
r["job closed under the capture: orphan, row voided with the reason, job not funded"] = r31.outcome === "orphan" && r31.status === "orphan:job_closed"
  && (await val(`select status from provider_payments where idempotency_key='k31'`)) === "voided"
  && (await val(`select payment_status from jobs where id='${J(31)}'`)) === "unpaid" ? "ok" : `bad ${JSON.stringify(r31)}`;
await expectOk("job 32 order", open(32, U.tester, "k32", "O32"));
await claim("k32");
await db.exec("reset role"); await db.exec(`update jobs set budget=200 where id='${J(32)}'`); await asServer(); // a server re-price under the capture
r["re-priced under the capture: orphan:price_changed"] = (await rec("k32", "CAP32")).status === "orphan:price_changed" ? "ok" : "bad";
await expectOk("job 33 order", open(33, U.tester, "k33", "O33"));
await claim("k33");
await db.exec("reset role"); await db.exec(`update jobs set status='cancelled' where id='${J(33)}'`); await asServer();
const rc = await claim("k33");
r["a re-claim (capture retry) re-checks the job: closed -> refused, row failed"] = rc.ok === false && rc.reason === "job_closed"
  && (await val(`select status from provider_payments where idempotency_key='k33'`)) === "failed" ? "ok" : `bad ${JSON.stringify(rc)}`;
r["a capture that still lands on that failed row is an orphan"] = (await rec("k33", "CAP33")).status === "orphan:failed" ? "ok" : "bad";
await expectOk("job 34 order (first job: setup fee)", open(34, U.tester, "k34", "O34", 10200, bd({ onboarding_fee_cents: 200, item_cents: 10200 })));
await expectOk("job 35 order (setup fee too)", open(35, U.tester, "k35", "O35", 10200, bd({ onboarding_fee_cents: 200, item_cents: 10200 })));
await claim("k34");
const c35 = await claim("k35");
r["two first-job orders: the second claim is refused while the first carries the fee"] = c35.reason === "setup_fee_already_paid" ? "ok" : `bad ${JSON.stringify(c35)}`;
r["the first is funded and collects the fee once"] = (await rec("k34", "CAP34", 10200)).onboarding_fee_duplicate === false ? "ok" : "bad";

// --- money-escrow re-review: a held PayPal job's payment state moves only through PayPal
// The setup fee paid elsewhere between claim and record: the duplicate is reported and NOT recorded on this job.
await db.exec("reset role");
await db.exec(`${job(41)}; update profiles set onboarding_fee_paid=false where user_id='${U.tester}'`);
await asServer();
await expectOk("job 41 order (setup fee)", open(41, U.tester, "k41", "O41", 10200, bd({ onboarding_fee_cents: 200, item_cents: 10200 })));
await claim("k41");
await db.exec("reset role"); await db.exec(`update profiles set onboarding_fee_paid=true where user_id='${U.tester}'`); await asServer();
const f41 = await rec("k41", "CAP41", 10200);
r["setup fee taken twice: flagged, and not recorded on the job"] = f41.outcome === "funded" && f41.onboarding_fee_duplicate === true
  && (await val(`select onboarding_fee_amount from jobs where id='${J(41)}'`)) === null ? "ok" : `bad ${JSON.stringify(f41)}`;
r["the setup fee is recorded on the job (a cancel keeps it)"] = Number(await val(`select onboarding_fee_amount from jobs where id='${J(34)}'`)) === 2 ? "ok" : "bad";
await asMember(U.tester);
await expectErr("a member cannot cancel a job whose PayPal money is held", `update jobs set status='cancelled' where id='${J(1)}'`, /paypal_payment_held/);
await expectErr("nor delete it", `delete from jobs where id='${J(1)}'`, /paypal_payment_held/);
await asServer();
await db.exec("reset role");
await expectErr("a Stripe-era server write cannot mark a PayPal job's money cancelled", `update jobs set payment_status='cancelled' where id='${J(1)}'`, /paypal_job_money_outside_paypal/);
await expectErr("nor released", `update jobs set payment_status='released' where id='${J(1)}'`, /paypal_job_money_outside_paypal/);
await expectOk("a Stripe-era job's payment state moves as before", `update jobs set payment_status='released' where id='${J(20)}'`);
// A visit payment that FUNDS a job (phase 6: provider_payments.funds_job_id) holds that job's money too.
await db.exec(`alter table provider_payments add column if not exists funds_job_id uuid`);
await db.exec(`insert into jobs(id, customer_id, budget, payment_status) values ('${J(40)}', '${U.tester}', 50, 'escrow')`);
await db.exec(`insert into provider_payments(subject_kind, subject_id, funds_job_id, payer_id, provider, env, idempotency_key, provider_order_id, provider_capture_id, amount_cents, status) values ('recurring_visit', gen_random_uuid(), '${J(40)}', '${U.tester}', 'paypal_checkout', 'sandbox', 'k40', 'O40', 'C40', 5000, 'captured')`);
await expectErr("a job funded by a PayPal visit payment: Stripe-era write refused", `update jobs set payment_status='cancelled' where id='${J(40)}'`, /paypal_job_money_outside_paypal/);
await asMember(U.tester);
await expectErr("and the member cannot cancel it", `update jobs set status='cancelled' where id='${J(40)}'`, /paypal_payment_held/);
await db.exec(`select set_config('app.paypal_sanctioned_cancel', '1', false)`);
await expectOk("phase 5's sanctioned cancel passes the member lock", `update jobs set status='cancelled' where id='${J(40)}'`);
await db.exec(`select set_config('app.paypal_sanctioned_cancel', '', false)`);
await db.exec("reset role");
await asServer();

// --- job_is_funded: for every job with NO provider_payments row the answer is exactly today's.
// "Today's" is the previous definition, read verbatim from 20260923123701 and renamed.
const prevDef = read("20260923123701_null_argument_never_allows.sql").match(/CREATE OR REPLACE FUNCTION public\.job_is_funded\(p_job_id uuid\)[\s\S]*?\$fn\$;/)[0]
  .replace("public.job_is_funded(", "public.prev_job_is_funded(");
await db.exec("reset role"); await db.exec(prevDef);
const STATUSES = [null, "unpaid", "escrow", "payout_pending", "released", "refunded", "cancelled", "abandoned", "failed", "chargeback", "cancelling"];
let k = 100;
const legacyDiffs = [];
for (const ps of STATUSES) {
  const id = J(++k);
  await db.exec(`insert into jobs(id, customer_id, budget, payment_status, stripe_payment_intent_id) values ('${id}', '${U.ordinary}', 50, ${ps === null ? "null" : `'${ps}'`}, ${k % 2 ? "'pi_x'" : "null"})`);
  const now = await val(`select public.job_is_funded('${id}')`);
  const before = await val(`select public.prev_job_is_funded('${id}')`);
  if (now !== before) legacyDiffs.push(`${ps}: ${before} -> ${now}`);
}
for (const arg of ["null", `'${J(999)}'`]) {
  const now = await val(`select public.job_is_funded(${arg}::uuid)`);
  if (now !== (await val(`select public.prev_job_is_funded(${arg}::uuid)`)) || now !== false) legacyDiffs.push(`${arg}: ${now}`);
}
r["job_is_funded unchanged for every job with no PayPal row (11 payment states, null id, missing job)"] = legacyDiffs.length === 0 ? "ok" : `bad ${legacyDiffs.join("; ")}`;
r["a Stripe-funded job stays funded"] = (await val(`select public.job_is_funded('${J(103)}')`)) === true ? "ok" : "bad";
r["an unfunded legacy job stays unfunded"] = (await val(`select public.job_is_funded('${J(102)}')`)) === false ? "ok" : "bad";
// PayPal jobs: funded only with a captured row.
await db.exec(`insert into jobs(id, customer_id, budget, payment_status) values ('${J(300)}', '${U.tester}', 50, 'escrow')`);
await db.exec(`insert into provider_payments(subject_kind, subject_id, payer_id, provider, env, idempotency_key, provider_order_id, provider_capture_id, amount_cents, status) values ('job', '${J(300)}', '${U.tester}', 'paypal_checkout', 'sandbox', 'k300', 'O300', 'C300', 5000, 'capture_pending')`);
r["PayPal job, capture pending (even if payment_status says escrow): not funded"] = (await val(`select public.job_is_funded('${J(300)}')`)) === false ? "ok" : "bad";
await db.exec(`update provider_payments set status='captured' where idempotency_key='k300'`);
r["PayPal job, captured: funded"] = (await val(`select public.job_is_funded('${J(300)}')`)) === true ? "ok" : "bad";
r["PayPal job 1 (captured above): funded"] = (await val(`select public.job_is_funded('${J(1)}')`)) === true ? "ok" : "bad";
r["PayPal job with only a created/voided order and unpaid: not funded"] = (await val(`select public.job_is_funded('${J(4)}')`)) === false ? "ok" : "bad";
{
  const acl = await val(`select proacl::text from pg_proc where proname='job_is_funded'`);
  r["job_is_funded grants unchanged (authenticated, service_role; not anon)"] = /authenticated=X/.test(acl) && /service_role=X/.test(acl) && !/anon=X|(^|[{,])=X/.test(acl) ? "ok" : `bad (${acl})`;
}
await asServer();

// --- legacy jobs keep their rule
await db.exec("reset role");
await db.exec(`insert into jobs(id, customer_id, budget, payment_status) values ('${J(20)}', '${U.ordinary}', 50, 'escrow'), ('${J(21)}', '${U.ordinary}', 50, 'unpaid')`);
await asMember(U.ordinary);
await expectOk("legacy funded job: award allowed", `update jobs set helper_id='${U.helpr}' where id='${J(20)}'`);
await expectErr("legacy unpaid job: award refused", `update jobs set helper_id='${U.helpr}' where id='${J(21)}'`, /not funded yet/);
await db.exec("reset role");

// --- NULL-safety of the two flags: a FRESH database where neither setting was ever set in the session.
{
  const fresh = new PGlite();
  await fresh.exec(FIXTURE);
  await fresh.exec(p1); await fresh.exec(p3);
  await fresh.exec("update feature_switches set audience='testers' where key='paypal_payments'");
  await fresh.exec(`insert into jobs(id, customer_id, budget, payment_status) values ('${J(1)}', '${U.tester}', 100, 'escrow')`);
  await fresh.exec(`insert into provider_payments(subject_kind, subject_id, payer_id, provider, env, idempotency_key, provider_order_id, provider_capture_id, amount_cents, status) values ('job', '${J(1)}', '${U.tester}', 'paypal_checkout', 'sandbox', 'f1', 'OF1', 'CF1', 10000, 'captured')`);
  const unset = (await fresh.query(`select current_setting('app.paypal_sanctioned_cancel', true) a, current_setting('app.paypal_money_write', true) b`)).rows[0];
  r["fresh session: neither flag was ever set (both read NULL)"] = unset.a === null && unset.b === null ? "ok" : `bad ${JSON.stringify(unset)}`;
  const tryF = async (label, sql, re) => { try { await fresh.query(sql); r[label] = "bad: allowed"; } catch (e) { r[label] = re.test(e.message) ? "ok" : `wrong: ${e.message}`; } };
  await tryF("fresh session: a server payment_status write on held PayPal money is refused", `update jobs set payment_status='cancelled' where id='${J(1)}'`, /paypal_job_money_outside_paypal/);
  await fresh.exec(`set role authenticated; set request.jwt.claim.sub = '${U.tester}'; set request.jwt.claim.role = 'authenticated'`);
  await tryF("fresh session: an unflagged member cancel of held PayPal money is refused", `update jobs set status='cancelled' where id='${J(1)}'`, /paypal_payment_held/);
  await fresh.close();
}

const bad = Object.entries(r).filter(([, v]) => !String(v).startsWith("ok"));
console.log(JSON.stringify(r, null, 1));
console.log(bad.length ? `FAILED: ${bad.map(([k]) => k).join(", ")}` : `ALL OK (${Object.keys(r).length} checks; both migrations applied 3x + 1 replay after a flip)`);
process.exit(bad.length ? 1 : 0);

#!/usr/bin/env node
/**
 * PGlite proof for 20261017045002_quote_hire_on_pay_alerts.sql (quotes on
 * jobs, owner answers 8, 10 and 11 of docs/specs/owner-questions-hub-1015.md).
 *
 *   npx tsx src/test/pglite/quoteHireOnPay.pglite.mjs [--replay] [--before]
 *
 * --before applies only 20261015091114_job_quotes.sql (main today): every
 * check must FAIL. Without it the new migration is applied on top (3x with
 * --replay) and every check must PASS.
 *
 * Real definitions (src/test/helpers/effectiveFunctionDefs.ts, newest before
 * this migration): require_feature, feature_enabled_for, contact_leak_reason,
 * is_server_context, enforce_jobs_insert_column_lock, job_payment_is_funded,
 * job_offer_cutoff, direct_accept_block_reason, complete_direct_offer_accept,
 * complete_job_accept, helper_accept_block_reason. Stubs (not under test):
 * feature_enabled_for_user (the switch row: 'everyone' = on), is_caller_banned,
 * member_under_18, are_users_blocked, mask_job_location, seed_hidden_*,
 * helper_accept_missing (a stub_unready table), get_user_credential_tier,
 * is_helper_shadowbanned, vault.decrypted_secrets, net.http_post (records each
 * call in net.calls).
 *
 *   8   the escrow write hires the quoter (job accepted, helper confirmed, an
 *       accepted application, poster + quoter told); a redelivered escrow write
 *       changes nothing; an unready quoter's yes waits in job_accept_pending; a
 *       refused completion (a block) still lands the payment and is logged; a
 *       plain direct offer (no quote) is untouched
 *   11  cancelling an agreed, never-funded request deletes its job; a funded one
 *       is refused and the job stays; a 'failed' payment (PaymentIntent) keeps
 *       its job
 *   10  a new quote and a counter are emailed (send-notification-email with the
 *       notification id), an accept is not; the sweep reminds once per reply
 *       window (a counter's new window reminds again), tells the poster how
 *       many quotes came in once, and sends nothing while the switch is off
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = "20261015091114_job_quotes.sql";
const THIS = "20261017045002_quote_hire_on_pay_alerts.sql";
// QUOTES2_MIGRATION: a planted-defect copy, for the mutant runs in the report.
const MIGRATION = readFileSync(process.env.QUOTES2_MIGRATION ?? DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

const DEFS = effectiveDefs(DIR, { before: BASE });
function fnStmt(name) {
  const d = DEFS.get(name);
  if (!d) throw new Error(`no migration before ${BASE} defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
}

const POSTER = "00000000-0000-0000-0000-00000000000a";
const QA = "00000000-0000-0000-0000-00000000000b";
const QB = "00000000-0000-0000-0000-00000000000c";
const QC = "00000000-0000-0000-0000-00000000000d";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users VALUES ('${POSTER}'),('${QA}'),('${QB}'),('${QC}');
GRANT USAGE ON SCHEMA public TO authenticated, anon;

CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'https://x.supabase.co'), ('service_role_key', 'k');
CREATE SCHEMA net;
CREATE TABLE net.calls (id serial PRIMARY KEY, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}', body jsonb DEFAULT '{}', timeout_milliseconds integer DEFAULT 5000)
  RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id::bigint $$;

CREATE TYPE public.job_category AS ENUM ('other', 'cleaning', 'yard_work');
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled');
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, avatar_url text, is_seed boolean NOT NULL DEFAULT false,
  ban_status text, auto_suspended_until timestamptz);
INSERT INTO public.profiles (user_id, full_name) VALUES ('${POSTER}','Poster'),('${QA}','Quoter A'),('${QB}','Quoter B'),('${QC}','Quoter C');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid, title text NOT NULL, description text NOT NULL,
  category public.job_category NOT NULL DEFAULT 'other', date_needed date NOT NULL,
  start_time time, estimated_hours numeric, location text, latitude numeric, longitude numeric,
  parish text, budget numeric NOT NULL CHECK (budget >= 10 AND budget <= 1000),
  status public.job_status NOT NULL DEFAULT 'open', payment_status text DEFAULT 'pending',
  stripe_payment_intent_id text, stripe_session_id text, boosted_at timestamptz, boost_expires_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false, helper_id uuid, recurring_helper_id uuid,
  helper_confirmed_at timestamptz, helper_on_the_way_at timestamptz, helper_arrived_at timestamptz,
  helper_arrival_verified_at timestamptz, helper_arrival_near_miss_at timestamptz, helper_arrival_near_miss_ft numeric,
  poster_confirmed_at timestamptz, helper_completed_at timestamptz, poster_completed_at timestamptz,
  payout_scheduled_at timestamptz, created_at timestamptz DEFAULT now(),
  offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz,
  parent_job_id uuid, expires_at timestamptz, credential_tier integer, response_deadline timestamptz
);
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, message text, status text, updated_at timestamptz DEFAULT now(), UNIQUE (job_id, helper_id));
CREATE TABLE public.job_accept_pending (job_id uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid NOT NULL, requested_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, severity text NOT NULL DEFAULT 'error',
  message text NOT NULL, stack text, url text, user_agent text, tags jsonb NOT NULL DEFAULT '{}', context jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text,
  type text CHECK (type IN ('new_offers', 'info', 'job_updates')), link text, job_id uuid);
CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text NOT NULL DEFAULT 'off', description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE TABLE public.stub_blocks (a uuid, b uuid);
CREATE TABLE public.stub_unready (user_id uuid PRIMARY KEY);

CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_uid uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.feature_switches WHERE key = p_key AND audience = 'everyone') $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.member_under_18(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.are_users_blocked(_user_a uuid, _user_b uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.stub_blocks WHERE (a = _user_a AND b = _user_b) OR (a = _user_b AND b = _user_a)) $$;
CREATE FUNCTION public.mask_job_location(loc text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'masked' $$;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.seed_hidden_for(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.helper_accept_missing(p_user_id uuid) RETURNS text[] LANGUAGE sql STABLE AS
  $$ SELECT CASE WHEN EXISTS (SELECT 1 FROM public.stub_unready u WHERE u.user_id = p_user_id) THEN ARRAY['payout_setup'] ELSE ARRAY[]::text[] END $$;
CREATE FUNCTION public.get_user_credential_tier(p_user_id uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.is_helper_shadowbanned(_helper_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
GRANT SELECT, UPDATE ON public.jobs TO authenticated;
`);
for (const fn of ["feature_enabled_for", "require_feature", "contact_leak_reason", "is_server_context", "enforce_jobs_insert_column_lock",
  "job_payment_is_funded", "job_offer_cutoff", "direct_accept_block_reason", "complete_job_accept", "complete_direct_offer_accept",
  "helper_accept_block_reason"]) {
  await db.exec(fnStmt(fn));
}
await db.exec(`CREATE TRIGGER trg_jobs_insert_column_lock BEFORE INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_jobs_insert_column_lock();`);
await db.exec(readFileSync(DIR + BASE, "utf8"));
if (!BEFORE) {
  for (let i = 0; i < (REPLAY ? 3 : 1); i++) await db.exec(MIGRATION);
}
await db.exec("UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'quotes'");

const results = [];
// control: holds on main too (no FAIL-before); it pins what the change must NOT do.
const check = (name, ok, detail = "", control = false) => {
  results.push({ name, ok, control });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
};
const as = async (uid, sql) => {
  await db.exec(`RESET ROLE; SET request.jwt.claim.sub = '${uid}'; SET request.jwt.claim.role = 'authenticated'; SET ROLE authenticated;`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("RESET ROLE; SET request.jwt.claim.sub = ''; SET request.jwt.claim.role = '';");
  }
};
const err = async (uid, sql) => {
  try {
    await as(uid, sql);
    return null;
  } catch (e) {
    return String(e.message);
  }
};
const one = async (uid, sql) => (await as(uid, sql)).rows[0];
// The webhook's own context: service_role, no member (is_server_context()).
const svc = async (sql) => {
  await db.exec("SET request.jwt.claim.role = 'service_role';");
  try {
    return (await db.query(sql)).rows;
  } finally {
    await db.exec("SET request.jwt.claim.role = '';");
  }
};
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    check(name, false, `threw: ${String(e.message).slice(0, 200)}`);
  }
};
let n = 0;
const newRequest = async () =>
  (await one(POSTER, `SELECT public.create_quote_request('Paint fence ${++n}', 'Two coats on a 60 ft wooden fence', 'yard_work',
     (now() + interval '5 days')::date, NULL, 4, '12 Oak St, Metairie, LA', 29.98, -90.15, 'Jefferson') AS id`)).id;
/** A request, one quote from `quoter`, the poster accepts, the poster books: the unpaid job. */
const agreedJob = async (quoter) => {
  const req = await newRequest();
  const q = (await one(quoter, `SELECT public.submit_job_quote('${req}', 25000, 'Paint included', 'Saturday') AS id`)).id;
  await as(POSTER, `SELECT public.respond_to_job_quote('${q}', 'accept')`);
  const job = (await one(POSTER, `SELECT public.book_accepted_quote('${req}') AS id`)).id;
  return { req, q, job };
};
const emails = async () => (await db.query("SELECT body FROM net.calls WHERE url LIKE '%/send-notification-email'")).rows.map((r) => r.body);

// ---- 8: paying hires the quoter
await step("8 the escrow write hires the quoter, and both are told", async () => {
  const { job } = await agreedJob(QA);
  const before = (await svc(`SELECT status::text, payment_status, offered_to_helper_id, direct_offer_status FROM public.jobs WHERE id = '${job}'`))[0];
  await svc(`UPDATE public.jobs SET payment_status = 'escrow', stripe_payment_intent_id = 'pi_1' WHERE id = '${job}'`);
  const j = (await svc(`SELECT status::text, helper_id, helper_confirmed_at IS NOT NULL AS confirmed, direct_offer_status FROM public.jobs WHERE id = '${job}'`))[0];
  const apps = (await svc(`SELECT status FROM public.applications WHERE job_id = '${job}' AND helper_id = '${QA}'`));
  const posterTold = (await svc(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${POSTER}' AND title LIKE '% accepted your offer' AND job_id = '${job}'`))[0].n;
  const quoterTold = (await svc(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${QA}' AND title = 'You''re booked'`))[0].n;
  // Redelivery: the webhook writes escrow over escrow again.
  await svc(`UPDATE public.jobs SET payment_status = 'escrow', stripe_payment_intent_id = 'pi_1' WHERE id = '${job}'`);
  const apps2 = (await svc(`SELECT count(*)::int AS n FROM public.applications WHERE job_id = '${job}'`))[0].n;
  const told2 = (await svc(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id IN ('${POSTER}', '${QA}') AND (title LIKE '% accepted your offer' OR title = 'You''re booked')`))[0].n;
  const errs = (await svc("SELECT count(*)::int AS n FROM public.error_logs"))[0].n;
  check(
    "8 the escrow write hires the quoter, and both are told",
    before.status === "open" && before.offered_to_helper_id === QA && before.direct_offer_status === "pending" &&
      j.status === "accepted" && j.helper_id === QA && j.confirmed === true && j.direct_offer_status === "accepted" &&
      apps.length === 1 && apps[0].status === "accepted" && posterTold === 1 && quoterTold === 1,
    `${j.status} ${j.helper_id === QA} confirmed=${j.confirmed} apps=${apps.length} told=${posterTold}/${quoterTold} errs=${errs}`,
  );
  check("8 a redelivered escrow write changes nothing (idempotent)", j.status === "accepted" && apps2 === 1 && told2 === 2 && errs === 0, `apps=${apps2} told=${told2} errs=${errs}`);
});

await step("8 an unready quoter's yes waits in job_accept_pending; the job stays a pending offer", async () => {
  await db.exec(`INSERT INTO public.stub_unready VALUES ('${QB}')`);
  const { job } = await agreedJob(QB);
  await svc(`UPDATE public.jobs SET payment_status = 'escrow', stripe_payment_intent_id = 'pi_2' WHERE id = '${job}'`);
  const j = (await svc(`SELECT status::text, helper_id, direct_offer_status, payment_status FROM public.jobs WHERE id = '${job}'`))[0];
  const pend = (await svc(`SELECT helper_id FROM public.job_accept_pending WHERE job_id = '${job}'`));
  // Redelivered while the quoter is still unready: told once, not twice.
  await svc(`UPDATE public.jobs SET payment_status = 'escrow', stripe_payment_intent_id = 'pi_2' WHERE id = '${job}'`);
  const told = (await svc(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${QB}' AND title = 'Finish setup to start'`))[0].n;
  await db.exec(`DELETE FROM public.stub_unready`);
  check(
    "8 an unready quoter's yes waits in job_accept_pending; the job stays a pending offer",
    j.status === "open" && j.helper_id === null && j.direct_offer_status === "pending" && j.payment_status === "escrow" &&
      pend.length === 1 && pend[0].helper_id === QB && told === 1,
    `${j.status} ${j.direct_offer_status} pending=${pend.length} told=${told}`,
  );
});

await step("8 a refused completion still lands the payment and is logged", async () => {
  const { job } = await agreedJob(QC);
  await db.exec(`INSERT INTO public.stub_blocks VALUES ('${POSTER}', '${QC}')`);
  const e = await svc(`UPDATE public.jobs SET payment_status = 'escrow', stripe_payment_intent_id = 'pi_3' WHERE id = '${job}' RETURNING id`)
    .then(() => null, (x) => String(x.message));
  const j = (await svc(`SELECT status::text, helper_id, payment_status FROM public.jobs WHERE id = '${job}'`))[0];
  const logged = (await svc(`SELECT count(*)::int AS n FROM public.error_logs WHERE tags->>'source' = 'quote_job_funded_hires_quoter' AND tags->>'job_id' = '${job}'`))[0].n;
  await db.exec(`DELETE FROM public.stub_blocks`);
  check(
    "8 a refused completion still lands the payment and is logged",
    e === null && j.payment_status === "escrow" && j.status === "open" && j.helper_id === null && logged === 1,
    `err=${e} ${j.payment_status} ${j.status} logged=${logged}`,
  );
});

await step("8 a plain direct offer (no quote) is not hired by its funding", async () => {
  const id = (await svc(`INSERT INTO public.jobs (customer_id, title, description, date_needed, budget, payment_status, offered_to_helper_id, direct_offer_status)
    VALUES ('${POSTER}', 'Mow', 'Mow the yard please', (now() + interval '5 days')::date, 50, 'unpaid', '${QA}', 'pending') RETURNING id`))[0].id;
  await svc(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = '${id}'`);
  const j = (await svc(`SELECT status::text, helper_id FROM public.jobs WHERE id = '${id}'`))[0];
  check("8 [control] a plain direct offer (no quote) is not hired by its funding", j.status === "open" && j.helper_id === null, `${j.status}`, true);
});

// ---- 11: cancel after agreeing, before paying
await step("11 cancelling an agreed, never-funded request deletes its job", async () => {
  const { req, job } = await agreedJob(QA);
  await as(POSTER, `SELECT public.cancel_quote_request('${req}')`);
  const left = (await svc(`SELECT count(*)::int AS n FROM public.jobs WHERE id = '${job}'`))[0].n;
  const r = (await svc(`SELECT status, job_id FROM public.job_quote_requests WHERE id = '${req}'`))[0];
  check("11 cancelling an agreed, never-funded request deletes its job", left === 0 && r.status === "cancelled" && r.job_id === null, `jobs=${left} ${r.status} ${r.job_id}`);
});

await step("11 a funded job is refused and kept; a failed payment keeps its job", async () => {
  await db.exec(`INSERT INTO public.stub_unready VALUES ('${QB}')`);
  const a = await agreedJob(QB);
  await svc(`UPDATE public.jobs SET payment_status = 'escrow', stripe_payment_intent_id = 'pi_4' WHERE id = '${a.job}'`);
  await db.exec(`DELETE FROM public.stub_unready`);
  const refused = await err(POSTER, `SELECT public.cancel_quote_request('${a.req}')`);
  const kept = (await svc(`SELECT count(*)::int AS n FROM public.jobs WHERE id = '${a.job}'`))[0].n;
  const b = await agreedJob(QC);
  await svc(`UPDATE public.jobs SET payment_status = 'failed', stripe_payment_intent_id = 'pi_5' WHERE id = '${b.job}'`);
  const ok = await err(POSTER, `SELECT public.cancel_quote_request('${b.req}')`);
  const keptFailed = (await svc(`SELECT count(*)::int AS n FROM public.jobs WHERE id = '${b.job}'`))[0].n;
  check(
    "11 [control] a funded job is refused and kept; a failed payment keeps its job",
    /request_booked/.test(refused ?? "") && kept === 1 && ok === null && keptFailed === 1,
    `${refused} kept=${kept} failed-cancel=${ok} keptFailed=${keptFailed}`,
    true,
  );
});

// ---- 10: alerts
await step("10 a new quote and a counter are emailed; an accept is not", async () => {
  await db.exec("DELETE FROM net.calls");
  const req = await newRequest();
  const q = (await one(QA, `SELECT public.submit_job_quote('${req}', 25000, 'Paint included', 'Saturday') AS id`)).id;
  const afterQuote = await emails();
  await as(POSTER, `SELECT public.respond_to_job_quote('${q}', 'counter', 22000, 'Can you do 220?')`);
  const afterCounter = await emails();
  await as(QA, `SELECT public.respond_to_job_quote('${q}', 'accept')`);
  const afterAccept = await emails();
  const ids = afterCounter.map((b) => b.notification_id);
  const rows = (await svc(`SELECT count(*)::int AS n FROM public.notifications WHERE id = ANY (ARRAY[${ids.map((i) => `'${i}'`).join(",") || "NULL"}]::uuid[])`))[0].n;
  check(
    "10 a new quote and a counter are emailed; an accept is not",
    afterQuote.length === 1 && afterQuote[0].user_id === POSTER && afterQuote[0].type === "new_offers" &&
      afterCounter.length === 2 && afterCounter[1].user_id === QA && rows === 2 && afterAccept.length === 2,
    `quote=${afterQuote.length} counter=${afterCounter.length} accept=${afterAccept.length} rows=${rows}`,
  );
});

await step("10 the sweep reminds once per reply window, and again for a counter's new window", async () => {
  const req = await newRequest();
  const q = (await one(QB, `SELECT public.submit_job_quote('${req}', 30000, 'Two coats', 'Any weekday') AS id`)).id;
  await svc(`UPDATE public.job_quotes SET respond_until = now() + interval '3 hours' WHERE id = '${q}'`);
  const s1 = (await svc("SELECT public.sweep_quote_alerts() AS r"))[0].r;
  const s2 = (await svc("SELECT public.sweep_quote_alerts() AS r"))[0].r;
  const toPoster = (await svc(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${POSTER}' AND title = 'A quote is waiting on you'`))[0].n;
  await as(POSTER, `SELECT public.respond_to_job_quote('${q}', 'counter', 28000)`);
  await svc(`UPDATE public.job_quotes SET respond_until = now() + interval '2 hours' WHERE id = '${q}'`);
  await svc("SELECT public.sweep_quote_alerts()");
  await svc("SELECT public.sweep_quote_alerts()");
  const toQuoter = (await svc(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${QB}' AND title = 'A counter-offer is waiting on you'`))[0].n;
  check(
    "10 the sweep reminds once per reply window, and again for a counter's new window",
    s1?.reminders >= 1 && s2?.reminders === 0 && toPoster === 1 && toQuoter === 1,
    `s1=${JSON.stringify(s1)} s2=${JSON.stringify(s2)} poster=${toPoster} quoter=${toQuoter}`,
  );
});

await step("10 the poster hears once how many quotes came in when the window closes", async () => {
  const req = await newRequest();
  await as(QA, `SELECT public.submit_job_quote('${req}', 25000, 'Paint included', 'Saturday')`);
  await as(QC, `SELECT public.submit_job_quote('${req}', 26000, 'Paint included', 'Sunday')`);
  const empty = await newRequest();
  await svc(`UPDATE public.job_quote_requests SET quotes_close_at = now() - interval '5 minutes' WHERE id IN ('${req}', '${empty}')`);
  await svc("SELECT public.sweep_quote_alerts()");
  await svc("SELECT public.sweep_quote_alerts()");
  const notes = (await svc(`SELECT message FROM public.notifications WHERE user_id = '${POSTER}' AND title = 'Quotes are closed' ORDER BY message`)).map((r) => r.message);
  check(
    "10 the poster hears once how many quotes came in when the window closes",
    notes.length === 2 && notes.some((m) => m.startsWith("2 quotes came in for")) && notes.some((m) => m.startsWith("No quotes came in")),
    JSON.stringify(notes),
  );
});

await step("10 the sweep sends nothing while the switch is off", async () => {
  const req = await newRequest();
  const q = (await one(QC, `SELECT public.submit_job_quote('${req}', 30000, 'Two coats', 'Any weekday') AS id`)).id;
  await svc(`UPDATE public.job_quotes SET respond_until = now() + interval '3 hours' WHERE id = '${q}'`);
  await svc(`UPDATE public.job_quote_requests SET quotes_close_at = now() - interval '5 minutes' WHERE id = '${req}'`);
  await db.exec("UPDATE public.feature_switches SET audience = 'off' WHERE key = 'quotes'");
  const r = (await svc("SELECT public.sweep_quote_alerts() AS r"))[0].r;
  await db.exec("UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'quotes'");
  check("10 the sweep sends nothing while the switch is off", r?.reminders === 0 && r?.closed_notices === 0, JSON.stringify(r));
});

await step("grants: the new helpers and the sweep are not client-callable", async () => {
  const rows = await svc(`SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS a,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('quote_notify_about', 'quote_job_funded_hires_quoter', 'sweep_quote_alerts', 'quote_notify')`);
  check("grants: the new helpers and the sweep are not client-callable", rows.length === 4 && rows.every((r) => !r.a && !r.u), JSON.stringify(rows));
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${BEFORE ? "BEFORE (main only)" : REPLAY ? "AFTER (migration x3)" : "AFTER (migration x1)"}: ${results.length - failed}/${results.length} pass`);
// Before: every behaviour check fails; the controls hold on main too.
if (BEFORE) process.exit(results.filter((r) => !r.control).every((r) => !r.ok) && results.filter((r) => r.control).every((r) => r.ok) ? 0 : 1);
process.exit(failed === 0 ? 0 : 1);

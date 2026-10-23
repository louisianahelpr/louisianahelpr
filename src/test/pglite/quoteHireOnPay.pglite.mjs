#!/usr/bin/env node
/**
 * PGlite proof for 20261018155222_quote_hire_on_pay_alerts.sql (quotes on
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
 *       (with train J's notify_helper_on_direct_offer + clock-restart triggers
 *       loaded from main) the quoter hears ONE notice at funding, never also
 *       "You got a direct job offer!", and nothing across a block; a completion
 *       that throws tells the quoter to accept by hand, never across a block
 *   11  cancelling an agreed, never-funded request deletes its job; a funded one
 *       is refused and the job stays; a 'failed' payment (PaymentIntent) keeps
 *       its job
 *   10  a new quote and a counter are emailed (send-notification-email with the
 *       notification id), an accept is not; the sweep reminds once per reply
 *       window (a counter's new window reminds again), tells the poster how
 *       many quotes came in once, and sends nothing while the switch is off
 *   Q1864 a block (a user_blocks row) closes the pair's pending quotes, both
 *       ways round, and leaves other quoters' quotes pending; a failure there
 *       never undoes the block, it is logged in error_logs
 *   links (20261019043546_quote_notices_link_the_quoter_view.sql, applied
 *       after this one, interleaved 3x with --replay): every quote notice
 *       about a request links '/quotes?request=<id>' (no job_id) and its
 *       reader is that request's poster or a quoter on it, on the side the
 *       title is for (QuotesHubRedirect decides the place at open time);
 *       "You're booked" / "Accept to start" carry job_id and '/jobs?job=<id>',
 *       "Finish setup to start" job_id and '/profile?tab=payment', each to the
 *       job's offered quoter; each email carries its row's link; the old two
 *       helpers are dropped. --links-before applies this migration but not that
 *       one: exactly the link checks FAIL and every other check holds. A
 *       planted QUOTES2_MIGRATION run leaves LINKS out too (it would overwrite
 *       the planted bodies) unless QUOTE_LINKS_MIGRATION is given.
 *   remind (20261023120308_quote_reminders_by_email.sql, Q2120, applied after
 *       LINKS): both 48 h reminders and the "Quotes are closed" notice are
 *       emailed as type 'quote_reminder' (send-notification-email gates it on
 *       notification_preferences.email_quote_reminders, default true) while
 *       the in-app row keeps type 'new_offers'; the close notice counts the
 *       quotes waiting on the poster (pending, 48 h left, a quoter on it, the
 *       poster's turn) apart from the ones that came in, and past the 2-hour
 *       start rule offers nothing; a new quote's
 *       email stays 'new_offers'. --remind-before leaves it out (and
 *       --links-before leaves it out too, since it builds on LINKS): exactly
 *       the remind checks FAIL. QUOTE_REMIND_MIGRATION plants a copy.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";
import { installClock, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = "20261015091114_job_quotes.sql";
const THIS = "20261018155222_quote_hire_on_pay_alerts.sql";
// QUOTES2_MIGRATION: a planted-defect copy, for the mutant runs in the report.
const MIGRATION = readFileSync(process.env.QUOTES2_MIGRATION ?? DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");
// The quoter's own link (applied after THIS): --links-before leaves it out.
const LINKS = "20261019043546_quote_notices_link_the_quoter_view.sql";
const LINKS_SQL = readFileSync(process.env.QUOTE_LINKS_MIGRATION ?? DIR + LINKS, "utf8");
// A planted copy of THIS migration (QUOTES2_MIGRATION) is NOT followed by the
// real LINKS migration: LINKS restates four of its functions and would replace
// the planted defect with a clean body (lead review 2026-10-19). Such a run
// leaves LINKS out unless a planted LINKS copy (QUOTE_LINKS_MIGRATION) is given.
const LINKS_BEFORE = process.argv.includes("--links-before") ||
  (!!process.env.QUOTES2_MIGRATION && !process.env.QUOTE_LINKS_MIGRATION);
// Q2120 (applied after LINKS, which it builds on): --remind-before leaves it out.
const REMIND = "20261023120308_quote_reminders_by_email.sql";
const REMIND_SQL = readFileSync(process.env.QUOTE_REMIND_MIGRATION ?? DIR + REMIND, "utf8");
const REMIND_BEFORE = process.argv.includes("--remind-before") || LINKS_BEFORE;
// Q2116: the decline needs funding, the poster is told on every not-hired path.
const Q16 = "20261023193937_quote_job_not_hired_tells_poster.sql";
const Q16_SQL = readFileSync(process.env.Q16_MIGRATION ?? DIR + Q16, "utf8");
const Q16_BEFORE = process.argv.includes("--q2116-before") || REMIND_BEFORE;

const DEFS = effectiveDefs(DIR, { before: BASE });
// Main's newest bodies BEFORE this migration (train J's direct-offer funding
// gate, 20261018024631): the offer notice and the clock restart both fire on
// the same funding UPDATE as the hire trigger.
const DEFS_MAIN = effectiveDefs(DIR, { before: THIS });
function fnStmt(name, defs = DEFS) {
  const d = defs.get(name);
  if (!d) throw new Error(`no migration before ${defs === DEFS ? BASE : THIS} defines ${name}`);
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
CREATE TABLE public.user_blocks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), blocker_id uuid NOT NULL, blocked_id uuid NOT NULL,
  reason text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (blocker_id, blocked_id));
-- As on prod (pg_policies, 2026-10-17): a member may write their own block row
-- straight through PostgREST, never via block_user_and_settle.
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can create their own blocks" ON public.user_blocks FOR INSERT WITH CHECK (auth.uid() = blocker_id);
GRANT INSERT ON public.user_blocks TO authenticated;
CREATE TABLE public.stub_unready (user_id uuid PRIMARY KEY);
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, email_new_offers boolean NOT NULL DEFAULT true);

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
CREATE TABLE public.stub_cron_defects (fn text, item text, err text, ctx jsonb);
CREATE FUNCTION public.log_cron_defect(p_fn text, p_item text, p_err text, p_ctx jsonb DEFAULT '{}') RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.stub_cron_defects VALUES (p_fn, p_item, p_err, p_ctx) $$;
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
for (const fn of ["notify_helper_on_direct_offer", "restart_direct_offer_clock_on_funding"]) await db.exec(fnStmt(fn, DEFS_MAIN));
await db.exec(`CREATE TRIGGER trg_notify_helper_on_direct_offer AFTER INSERT OR UPDATE OF offered_to_helper_id, payment_status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.notify_helper_on_direct_offer();
CREATE TRIGGER trg_restart_direct_offer_clock_on_funding BEFORE UPDATE OF payment_status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.restart_direct_offer_clock_on_funding();`);
if (!BEFORE) {
  for (let i = 0; i < (REPLAY ? 3 : 1); i++) {
    await db.exec(MIGRATION);
    if (!LINKS_BEFORE) await db.exec(LINKS_SQL);
    if (!REMIND_BEFORE) await db.exec(REMIND_SQL);
    if (!Q16_BEFORE) await db.exec(Q16_SQL);
  }
}
await db.exec("UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'quotes'");

const results = [];
// control: holds on main too (no FAIL-before); it pins what the change must NOT do.
// links: a check of the quoter's own link (LINKS); --links-before must fail exactly these.
// remind: a Q2120 check (REMIND); --remind-before must fail exactly these.
const check = (name, ok, detail = "", control = false, links = false, remind = false, q16 = false) => {
  results.push({ name, ok, control, links, remind, q16 });
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
  // Blocked AND unready: the block wins; never "Finish setup" across a block.
  await db.exec(`INSERT INTO public.stub_blocks VALUES ('${POSTER}', '${QC}'); INSERT INTO public.stub_unready VALUES ('${QC}')`);
  const e = await svc(`UPDATE public.jobs SET payment_status = 'escrow', stripe_payment_intent_id = 'pi_3' WHERE id = '${job}' RETURNING id`)
    .then(() => null, (x) => String(x.message));
  const j = (await svc(`SELECT status::text, helper_id, payment_status FROM public.jobs WHERE id = '${job}'`))[0];
  const logged = (await svc(`SELECT count(*)::int AS n FROM public.error_logs WHERE tags->>'source' = 'quote_job_funded_hires_quoter' AND tags->>'job_id' = '${job}'`))[0].n;
  const toldQC = (await svc(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${QC}' AND title IN ('Finish setup to start', 'You''re booked')`))[0].n;
  const pendQC = (await svc(`SELECT count(*)::int AS n FROM public.job_accept_pending WHERE job_id = '${job}'`))[0].n;
  await db.exec(`DELETE FROM public.stub_blocks; DELETE FROM public.stub_unready`);
  check(
    "8 a refused completion still lands the payment and is logged",
    e === null && j.payment_status === "escrow" && j.status === "open" && j.helper_id === null && logged === 1 && toldQC === 0 && pendQC === 0,
    `err=${e} ${j.payment_status} ${j.status} logged=${logged} toldAcrossBlock=${toldQC} pending=${pendQC}`,
  );
});

await step("8 at funding the quoter hears one notice, never also the direct-offer notice", async () => {
  // Train J (20261018024631) sends "You got a direct job offer!" on the same
  // funding UPDATE that hires the quoter; the hire trigger owns that moment.
  const offerNotices = async (uid, job) => (await svc(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${uid}' AND job_id = '${job}' AND title = 'You got a direct job offer!'`))[0].n;
  const a = await agreedJob(QA);
  await svc(`UPDATE public.jobs SET payment_status = 'escrow', stripe_payment_intent_id = 'pi_8' WHERE id = '${a.job}'`);
  const qaHired = await offerNotices(QA, a.job);
  // Unready quoter: "Finish setup to start" only.
  await db.exec(`INSERT INTO public.stub_unready VALUES ('${QB}')`);
  const b = await agreedJob(QB);
  await svc(`UPDATE public.jobs SET payment_status = 'escrow', stripe_payment_intent_id = 'pi_9' WHERE id = '${b.job}'`);
  await db.exec(`DELETE FROM public.stub_unready`);
  const qbPending = await offerNotices(QB, b.job);
  // A block after booking: nothing reaches the quoter across it.
  const c = await agreedJob(QC);
  await db.exec(`INSERT INTO public.stub_blocks VALUES ('${QC}', '${POSTER}')`);
  await svc(`UPDATE public.jobs SET payment_status = 'escrow', stripe_payment_intent_id = 'pi_10' WHERE id = '${c.job}'`);
  await db.exec(`DELETE FROM public.stub_blocks`);
  const qcBlocked = (await svc(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${QC}' AND job_id = '${c.job}'`))[0].n;
  check(
    "8 at funding the quoter hears one notice, never also the direct-offer notice",
    qaHired === 0 && qbPending === 0 && qcBlocked === 0,
    `hired=${qaHired} pendingSetup=${qbPending} acrossBlock=${qcBlocked}`,
  );
});

await step("8 a completion that throws: the quoter is told to accept by hand, never across a block", async () => {
  // Plant a throw (not a refusal) in the completion, then in the block check.
  const plant = (fn, args) => db.exec(`CREATE OR REPLACE FUNCTION public.${fn}(${args}) RETURNS ${fn === "complete_direct_offer_accept" ? "jsonb" : "text"}
    LANGUAGE plpgsql AS $p$ BEGIN RAISE EXCEPTION 'planted'; END $p$;`);
  const told = async (uid) => (await svc(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${uid}' AND title = 'Accept to start'`))[0].n;
  const a = await agreedJob(QA);
  await plant("complete_direct_offer_accept", "p_job_id uuid, p_helper uuid");
  const e = await svc(`UPDATE public.jobs SET payment_status = 'escrow', stripe_payment_intent_id = 'pi_11' WHERE id = '${a.job}' RETURNING id`)
    .then(() => null, (x) => String(x.message));
  await db.exec(fnStmt("complete_direct_offer_accept"));
  const j = (await svc(`SELECT status::text, helper_id, payment_status, direct_offer_status FROM public.jobs WHERE id = '${a.job}'`))[0];
  const tA = await told(QA);
  const logged = (await svc(`SELECT context->>'error' AS e FROM public.error_logs WHERE tags->>'job_id' = '${a.job}'`));
  // A block since booking, and the block check itself throws: nobody is told.
  const c = await agreedJob(QC);
  await db.exec(`INSERT INTO public.stub_blocks VALUES ('${POSTER}', '${QC}')`);
  await plant("direct_accept_block_reason", "p_job_id uuid, p_helper uuid");
  await svc(`UPDATE public.jobs SET payment_status = 'escrow', stripe_payment_intent_id = 'pi_12' WHERE id = '${c.job}'`);
  await db.exec(fnStmt("direct_accept_block_reason"));
  await db.exec(`DELETE FROM public.stub_blocks`);
  const tC = await told(QC);
  check(
    "8 a completion that throws: the quoter is told to accept by hand, never across a block",
    e === null && j.payment_status === "escrow" && j.helper_id === null && j.direct_offer_status === "pending" &&
      tA === 1 && logged.length === 1 && /planted/.test(logged[0].e ?? "") && tC === 0,
    `err=${e} ${j.payment_status} ${j.direct_offer_status} toldA=${tA} logged=${JSON.stringify(logged)} acrossBlock=${tC}`,
  );
});

await step("8 a cancel or chargeback put back to escrow never hires", async () => {
  await db.exec(`INSERT INTO public.stub_unready VALUES ('${QA}')`);
  const { job } = await agreedJob(QA);
  await svc(`UPDATE public.jobs SET payment_status = 'escrow', stripe_payment_intent_id = 'pi_7' WHERE id = '${job}'`);
  // Setup finishes later; the poster cancels, the refund stops, the claim is handed back.
  await db.exec(`DELETE FROM public.stub_unready; DELETE FROM public.job_accept_pending WHERE job_id = '${job}'`);
  await svc(`UPDATE public.jobs SET payment_status = 'cancelling' WHERE id = '${job}'`);
  await svc(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = '${job}'`);
  await svc(`UPDATE public.jobs SET payment_status = 'chargeback' WHERE id = '${job}'`);
  await svc(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = '${job}'`);
  const j = (await svc(`SELECT status::text, helper_id FROM public.jobs WHERE id = '${job}'`))[0];
  check("8 a cancel or chargeback put back to escrow never hires", j.status === "open" && j.helper_id === null, `${j.status} ${j.helper_id}`, true);
});

await step("8 a paid quote job whose offer already lapsed hires nobody, and is logged", async () => {
  const { job } = await agreedJob(QA);
  await svc(`UPDATE public.jobs SET direct_offer_status = 'expired' WHERE id = '${job}'`);
  await svc(`UPDATE public.jobs SET payment_status = 'escrow', stripe_payment_intent_id = 'pi_6' WHERE id = '${job}'`);
  const j = (await svc(`SELECT status::text, helper_id, payment_status FROM public.jobs WHERE id = '${job}'`))[0];
  const logged = (await svc(`SELECT context->>'block_reason' AS r FROM public.error_logs WHERE tags->>'job_id' = '${job}'`));
  check(
    "8 a paid quote job whose offer already lapsed hires nobody, and is logged",
    j.payment_status === "escrow" && j.helper_id === null && logged.length === 1 && /^offer_not_pending:expired/.test(logged[0].r ?? ""),
    `${j.payment_status} ${j.helper_id} logged=${JSON.stringify(logged)}`,
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

await step("10 one row that cannot be sent never holds back the rest; it is released and filed", async () => {
  await db.exec(`CREATE OR REPLACE FUNCTION public.stub_boom() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.message LIKE '%Boom fence%' AND NEW.title = 'A quote is waiting on you' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $$;
    DROP TRIGGER IF EXISTS stub_boom ON public.notifications;
    CREATE TRIGGER stub_boom BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.stub_boom();`);
  const bad = (await one(POSTER, `SELECT public.create_quote_request('Boom fence', 'Two coats on a 60 ft wooden fence', 'yard_work',
     (now() + interval '5 days')::date, NULL, 4, NULL, NULL, NULL, NULL) AS id`)).id;
  const good = await newRequest();
  const qBad = (await one(QA, `SELECT public.submit_job_quote('${bad}', 25000, 'Paint included', 'Saturday') AS id`)).id;
  const qGood = (await one(QA, `SELECT public.submit_job_quote('${good}', 25000, 'Paint included', 'Saturday') AS id`)).id;
  await svc(`UPDATE public.job_quotes SET respond_until = now() + interval '3 hours' WHERE id IN ('${qBad}', '${qGood}')`);
  const r = (await svc("SELECT public.sweep_quote_alerts() AS r"))[0].r;
  const marks = await svc(`SELECT id, reminder_sent_for IS NOT NULL AS claimed FROM public.job_quotes WHERE id IN ('${qBad}', '${qGood}')`);
  const filed = (await svc(`SELECT count(*)::int AS n FROM public.stub_cron_defects WHERE fn = 'sweep_quote_alerts' AND item = '${qBad}'`))[0].n;
  await db.exec("DROP TRIGGER stub_boom ON public.notifications");
  const claimed = Object.fromEntries(marks.map((m) => [m.id, m.claimed]));
  check(
    "10 one row that cannot be sent never holds back the rest; it is released and filed",
    r?.reminders === 1 && claimed[qGood] === true && claimed[qBad] === false && filed === 1,
    `r=${JSON.stringify(r)} good=${claimed[qGood]} bad=${claimed[qBad]} filed=${filed}`,
  );
});

await step("10 the sweep sends nothing while the switch is off", async () => {
  // The poster's earlier requests count toward the 5-open cap; close them.
  await svc("UPDATE public.job_quote_requests SET status = 'cancelled' WHERE status = 'open'");
  const req = await newRequest();
  const q = (await one(QC, `SELECT public.submit_job_quote('${req}', 30000, 'Two coats', 'Any weekday') AS id`)).id;
  await svc(`UPDATE public.job_quotes SET respond_until = now() + interval '3 hours' WHERE id = '${q}'`);
  await svc(`UPDATE public.job_quote_requests SET quotes_close_at = now() - interval '5 minutes' WHERE id = '${req}'`);
  await db.exec("UPDATE public.feature_switches SET audience = 'off' WHERE key = 'quotes'");
  const r = (await svc("SELECT public.sweep_quote_alerts() AS r"))[0].r;
  await db.exec("UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'quotes'");
  check("10 the sweep sends nothing while the switch is off", r?.reminders === 0 && r?.closed_notices === 0, JSON.stringify(r));
});

// ---- Q1864: a block closes the pair's pending quotes
await step("Q1864 a block closes the pair's pending quotes, both ways round; other quotes stay pending", async () => {
  // The poster's earlier requests count toward the 5-open cap; close them. The
  // switch on again: on main the switch-off step above throws before it is
  // turned back on, and --before must fail on the block, not on the switch.
  await svc("UPDATE public.job_quote_requests SET status = 'cancelled' WHERE status = 'open'");
  await db.exec("UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'quotes'");
  const req = await newRequest();
  const qa = (await one(QA, `SELECT public.submit_job_quote('${req}', 25000, 'Paint included', 'Saturday') AS id`)).id;
  const qc = (await one(QC, `SELECT public.submit_job_quote('${req}', 26000, 'Paint included', 'Sunday') AS id`)).id;
  // The other way round: QA asks for quotes, the poster quotes.
  const theirs = (await one(QA, `SELECT public.create_quote_request('Hedge trim', 'Trim a 40 ft privet hedge', 'yard_work',
     (now() + interval '5 days')::date, NULL, 2, NULL, NULL, NULL, NULL) AS id`)).id;
  const mine = (await one(POSTER, `SELECT public.submit_job_quote('${theirs}', 15000, 'Clippings hauled', 'Friday') AS id`)).id;
  // As the member, through RLS: the direct-PostgREST path the trigger exists for.
  await as(POSTER, `INSERT INTO public.user_blocks (blocker_id, blocked_id, reason) VALUES ('${POSTER}', '${QA}', 'test')`);
  const st = Object.fromEntries((await svc(`SELECT id, status FROM public.job_quotes WHERE id IN ('${qa}', '${qc}', '${mine}')`)).map((r) => [r.id, r.status]));
  await svc(`UPDATE public.job_quote_requests SET status = 'cancelled' WHERE id = '${theirs}'`);
  check(
    "Q1864 a block closes the pair's pending quotes, both ways round; other quotes stay pending",
    st[qa] === "closed" && st[mine] === "closed" && st[qc] === "pending",
    JSON.stringify(st),
  );
});

await step("Q1864 a failure closing the quotes never undoes the block; it is logged and the quote stays pending", async () => {
  await db.exec(`CREATE OR REPLACE FUNCTION public.stub_quote_boom() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'boom'; END $$;
    CREATE TRIGGER stub_quote_boom BEFORE UPDATE ON public.job_quotes FOR EACH ROW EXECUTE FUNCTION public.stub_quote_boom();`);
  let blockErr = null;
  try {
    await as(POSTER, `INSERT INTO public.user_blocks (blocker_id, blocked_id, reason) VALUES ('${POSTER}', '${QC}', 'test')`);
  } catch (e) {
    blockErr = String(e.message);
  }
  await db.exec("DROP TRIGGER stub_quote_boom ON public.job_quotes");
  const blocked = (await svc(`SELECT count(*)::int AS n FROM public.user_blocks WHERE blocker_id = '${POSTER}' AND blocked_id = '${QC}'`))[0].n;
  const logged = (await svc(`SELECT count(*)::int AS n FROM public.error_logs WHERE tags->>'source' = 'quote_close_pending_across_block'
    AND context->>'blocked_id' = '${QC}'`))[0].n;
  const pending = (await svc(`SELECT count(*)::int AS n FROM public.job_quotes WHERE quoter_id = '${QC}' AND status = 'pending'`))[0].n;
  check(
    "Q1864 a failure closing the quotes never undoes the block; it is logged and the quote stays pending",
    blockErr === null && blocked === 1 && logged === 1 && pending >= 1,
    `err=${blockErr} blocked=${blocked} logged=${logged} pending=${pending}`,
  );
});

// ---- links: each quote notice opens the view of the side it is addressed to.
await step("links: decline and counter, both ways round", async () => {
  // Earlier steps leave requests open; the 5-open-request cap is not under test.
  await svc("UPDATE public.job_quote_requests SET status = 'cancelled' WHERE status = 'open'");
  // The poster counters, the quoter counters back, the poster declines.
  const r1 = await newRequest();
  const q1 = (await one(QB, `SELECT public.submit_job_quote('${r1}', 26000, 'Two coats', 'Friday') AS id`)).id;
  await as(POSTER, `SELECT public.respond_to_job_quote('${q1}', 'counter', 21000)`);
  await as(QB, `SELECT public.respond_to_job_quote('${q1}', 'counter', 24000)`);
  await as(POSTER, `SELECT public.respond_to_job_quote('${q1}', 'decline')`);
  // The poster counters; the quoter declines the counter.
  const r2 = await newRequest();
  const q2 = (await one(QC, `SELECT public.submit_job_quote('${r2}', 27000, 'Two coats', 'Monday') AS id`)).id;
  await as(POSTER, `SELECT public.respond_to_job_quote('${q2}', 'counter', 20000)`);
  await as(QC, `SELECT public.respond_to_job_quote('${q2}', 'decline')`);
});

// Q1357: the sweep's clock edges on a FIXED clock (fixedClock.mjs). The newest
// ---- remind (Q2120): reminders and the close notice by email, own switch
// Emails sent since `mark` (net.calls is not cleared: the links checks below read every email of the run).
const callMark = async () => (await db.query("SELECT COALESCE(max(id), 0) AS m FROM net.calls")).rows[0].m;
const emailsSince = async (mark) =>
  (await db.query(`SELECT body FROM net.calls WHERE url LIKE '%/send-notification-email' AND id > ${mark}`)).rows.map((r) => r.body);
const remindStep = (name, fn) => step(name, async () => {
  await svc("UPDATE public.job_quote_requests SET status = 'cancelled' WHERE status = 'open'");
  await fn(await callMark());
});
const remindCheck = (name, ok, detail) => check(name, ok, detail, false, false, true);

await remindStep("remind: both 48 h reminders are emailed as quote_reminder; the in-app row stays new_offers", async (mark) => {
  const req = await newRequest();
  const q = (await one(QA, `SELECT public.submit_job_quote('${req}', 30000, 'Two coats', 'Any weekday') AS id`)).id;
  const afterQuote = await emailsSince(mark);
  await svc(`UPDATE public.job_quotes SET respond_until = now() + interval '3 hours' WHERE id = '${q}'`);
  await svc("SELECT public.sweep_quote_alerts()");
  await as(POSTER, `SELECT public.respond_to_job_quote('${q}', 'counter', 28000)`);
  await svc(`UPDATE public.job_quotes SET respond_until = now() + interval '2 hours' WHERE id = '${q}'`);
  await svc("SELECT public.sweep_quote_alerts()");
  const all = await emailsSince(mark);
  const toPoster = all.filter((b) => b.title === "A quote is waiting on you");
  const toQuoter = all.filter((b) => b.title === "A counter-offer is waiting on you");
  const ids = [...toPoster, ...toQuoter].map((b) => `'${b.notification_id}'`).join(",") || "NULL";
  const rowTypes = (await svc(`SELECT DISTINCT type FROM public.notifications WHERE id = ANY (ARRAY[${ids}]::uuid[])`)).map((r) => r.type);
  remindCheck(
    "remind: both 48 h reminders are emailed as quote_reminder; the in-app row stays new_offers",
    afterQuote.length === 1 && afterQuote[0].type === "new_offers" &&
      toPoster.length === 1 && toPoster[0].user_id === POSTER && toPoster[0].type === "quote_reminder" &&
      toPoster[0].link === `/quotes?request=${req}&user=${QA}` &&
      toQuoter.length === 1 && toQuoter[0].user_id === QA && toQuoter[0].type === "quote_reminder" &&
      rowTypes.length === 1 && rowTypes[0] === "new_offers",
    `quote=${afterQuote.map((b) => b.type)} poster=${JSON.stringify(toPoster.map((b) => [b.type, b.link]))} quoter=${toQuoter.map((b) => b.type)} rows=${rowTypes}`,
  );
});

await remindStep("remind: the close notice is emailed and counts the quotes waiting on the poster", async () => {
  // mixed: one declined, one waiting on the poster, one whose 48 h ran out.
  const mixed = await newRequest();
  const q1 = (await one(QA, `SELECT public.submit_job_quote('${mixed}', 25000, 'Paint included', 'Saturday') AS id`)).id;
  await as(QB, `SELECT public.submit_job_quote('${mixed}', 26000, 'Paint included', 'Sunday')`);
  const q3 = (await one(QC, `SELECT public.submit_job_quote('${mixed}', 27000, 'Paint included', 'Monday') AS id`)).id;
  await as(POSTER, `SELECT public.respond_to_job_quote('${q1}', 'decline')`);
  await svc(`UPDATE public.job_quotes SET respond_until = now() - interval '1 minute' WHERE id = '${q3}'`);
  // theirs: the poster countered, so it waits on the quoter (not_your_turn for the poster).
  const theirs = await newRequest();
  const q4 = (await one(QA, `SELECT public.submit_job_quote('${theirs}', 25000, 'Paint included', 'Saturday') AS id`)).id;
  await as(POSTER, `SELECT public.respond_to_job_quote('${q4}', 'counter', 22000)`);
  const live = await newRequest();
  await as(QA, `SELECT public.submit_job_quote('${live}', 25000, 'Paint included', 'Saturday')`);
  // late: the window closed at the 2-hour start rule; nothing can be agreed or posted.
  const late = await newRequest();
  await as(QB, `SELECT public.submit_job_quote('${late}', 25000, 'Paint included', 'Saturday')`);
  const lateEmpty = await newRequest();
  await svc(`UPDATE public.job_quote_requests SET date_needed = ((now() AT TIME ZONE 'America/Chicago') - interval '1 day')::date
    WHERE id IN ('${late}', '${lateEmpty}')`);
  await svc(`UPDATE public.job_quote_requests SET quotes_close_at = now() - interval '5 minutes'
    WHERE id IN ('${mixed}', '${theirs}', '${live}', '${late}', '${lateEmpty}')`);
  const mark = await callMark();
  await svc("SELECT public.sweep_quote_alerts()");
  await svc("SELECT public.sweep_quote_alerts()");
  const closed = (await emailsSince(mark)).filter((b) => b.title === "Quotes are closed");
  const by = (id) => closed.filter((b) => b.link.startsWith(`/quotes?request=${id}`)).map((b) => b.message);
  const [m, t, l, z, ze] = [by(mixed), by(theirs), by(live), by(late), by(lateEmpty)];
  remindCheck(
    "remind: the close notice is emailed and counts the quotes waiting on the poster",
    closed.length === 5 && closed.every((b) => b.type === "quote_reminder" && b.user_id === POSTER) &&
      m.length === 1 && /^3 quotes came in for ".*", and 1 is waiting on you\. Accept it/.test(m[0]) &&
      t.length === 1 && /^1 quote came in for ".*", and none is waiting on you\. You can set your own price/.test(t[0]) &&
      l.length === 1 && /^1 quote came in for ".*"\. Accept it, counter it/.test(l[0]) &&
      z.length === 1 && /^1 quote came in for ".*", but the job starts too soon to agree on one now\.$/.test(z[0]) &&
      ze.length === 1 && /^No quotes came in for "[^"]*"\.$/.test(ze[0]),
    JSON.stringify({ n: closed.length, types: closed.map((b) => b.type), m, t, l, z, ze }),
  );
});

await step("remind: the email switch exists, defaults on, and quote_notify_to has one 9-argument form", async () => {
  await svc(`INSERT INTO public.notification_preferences (user_id) VALUES ('${QC}') ON CONFLICT DO NOTHING`);
  const pref = await svc(`SELECT email_quote_reminders AS v FROM public.notification_preferences WHERE user_id = '${QC}'`)
    .then((r) => r[0]?.v, () => "missing");
  const sigs = (await svc(`SELECT p.oid::regprocedure::text AS s FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'quote_notify_to'`)).map((r) => r.s);
  remindCheck(
    "remind: the email switch exists, defaults on, and quote_notify_to has one 9-argument form",
    pref === true && sigs.length === 1 && sigs[0] === "quote_notify_to(uuid,text,text,uuid,boolean,uuid,uuid,boolean,text)",
    `pref=${pref} sigs=${JSON.stringify(sigs)}`,
  );
});

// "sweep_quote_alerts" body is reloaded with every now() pointed at
// _probe_now(), so each boundary is exact: a reply window ending exactly 4 h out
// reminds and one a second later does not; a quote window closed exactly now
// notices, one closing a second later does not yet, and one closed exactly a
// day ago never does. One second later the two waiting rows go. Last on
// purpose: it replaces the sweep body for the rest of the run. On --before the
// migration is not loaded, the sweep does not exist, and this fails.
await step("10 the sweep's 4 h reminder and 1-day close-notice edges, on a fixed clock", async () => {
  if (BEFORE) throw new Error("sweep_quote_alerts is not on main");
  await installClock(db);
  // Whichever migration defined it last in THIS run: LINKS (real or planted)
  // when it was applied, else THIS one (real or planted).
  const SWEEP = /CREATE OR REPLACE FUNCTION public\.sweep_quote_alerts\(\)[\s\S]*?\$fn\$[\s\S]*?\$fn\$;/;
  const sweepStmt = LINKS_BEFORE ? SWEEP.exec(MIGRATION)[0] : REMIND_BEFORE ? SWEEP.exec(LINKS_SQL)[0] : SWEEP.exec(REMIND_SQL)[0];
  await db.exec(onFixedClock(sweepStmt));
  const T = "2030-06-01T12:00:00Z";
  await setClock(db, T);
  await svc("UPDATE public.job_quote_requests SET status = 'cancelled' WHERE status = 'open'");
  const [ra, rb, rc, rd, re] = [await newRequest(), await newRequest(), await newRequest(), await newRequest(), await newRequest()];
  const qa = (await one(QA, `SELECT public.submit_job_quote('${ra}', 25000, 'Paint included', 'Saturday') AS id`)).id;
  const qb = (await one(QB, `SELECT public.submit_job_quote('${rb}', 25000, 'Paint included', 'Saturday') AS id`)).id;
  await svc(`UPDATE public.job_quote_requests SET date_needed = '2030-06-10', quotes_close_at = '${T}'::timestamptz + interval '10 days'
    WHERE id IN ('${ra}', '${rb}', '${rc}', '${rd}', '${re}')`);
  await svc(`UPDATE public.job_quotes SET respond_until = '${T}'::timestamptz + interval '4 hours' WHERE id = '${qa}'`);
  await svc(`UPDATE public.job_quotes SET respond_until = '${T}'::timestamptz + interval '4 hours 1 second' WHERE id = '${qb}'`);
  await svc(`UPDATE public.job_quote_requests SET quotes_close_at = '${T}'::timestamptz WHERE id = '${rc}'`);
  await svc(`UPDATE public.job_quote_requests SET quotes_close_at = '${T}'::timestamptz + interval '1 second' WHERE id = '${rd}'`);
  await svc(`UPDATE public.job_quote_requests SET quotes_close_at = '${T}'::timestamptz - interval '1 day' WHERE id = '${re}'`);
  const marks = async () => {
    const q = await svc(`SELECT id, reminder_sent_for IS NOT NULL AS m FROM public.job_quotes WHERE id IN ('${qa}', '${qb}')`);
    const r = await svc(`SELECT id, close_notice_sent_at IS NOT NULL AS m FROM public.job_quote_requests WHERE id IN ('${rc}', '${rd}', '${re}')`);
    const m = Object.fromEntries([...q, ...r].map((x) => [x.id, x.m]));
    return [m[qa], m[qb], m[rc], m[rd], m[re]].map((b) => (b ? 1 : 0)).join("");
  };
  const r1 = (await svc("SELECT public.sweep_quote_alerts() AS r"))[0].r;
  const m1 = await marks();
  await setClock(db, "2030-06-01T12:00:01Z");
  const r2 = (await svc("SELECT public.sweep_quote_alerts() AS r"))[0].r;
  const m2 = await marks();
  check(
    "10 the sweep's 4 h reminder and 1-day close-notice edges, on a fixed clock",
    r1?.reminders === 1 && r1?.closed_notices === 1 && m1 === "10100" && r2?.reminders === 1 && r2?.closed_notices === 1 && m2 === "11110",
    `r1=${JSON.stringify(r1)} m1=${m1} r2=${JSON.stringify(r2)} m2=${m2}`,
  );
});

await step("links: every quote notice carries a reference its reader's side is read from (request), or the job", async () => {
  const QUOTE_TITLES = ["New quote", "New counter-offer", "Quote accepted", "Quote declined", "A quote is waiting on you",
    "Quotes are closed", "A counter-offer is waiting on you", "You're booked", "Finish setup to start", "Accept to start"];
  const rows = await svc(`SELECT n.id, n.user_id, n.title, n.link, n.job_id FROM public.notifications n
    WHERE n.type = 'new_offers' AND n.title = ANY($1::text[]) ORDER BY n.title`.replace("$1::text[]",
    `ARRAY[${QUOTE_TITLES.map((t) => `'${t.replace(/'/g, "''")}'`).join(",")}]::text[]`));
  const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const requestRe = new RegExp(`^/quotes\\?request=(${UUID})&user=${UUID}$`);
  const jobRe = new RegExp(`^/jobs\\?job=(${UUID})&user=${UUID}$`);
  const payoutRe = new RegExp(`^/profile\\?tab=payment&user=${UUID}$`);
  const JOB_TITLES = new Set(["You're booked", "Accept to start"]);
  const POSTER_TITLES = new Set(["New quote", "A quote is waiting on you", "Quotes are closed"]);
  const QUOTER_TITLES = new Set(["A counter-offer is waiting on you", "You're booked", "Finish setup to start", "Accept to start"]);
  const reqs = new Map((await svc(`SELECT id, poster_id FROM public.job_quote_requests`)).map((r) => [r.id, r.poster_id]));
  const quoters = new Set((await svc(`SELECT request_id || ':' || quoter_id AS k FROM public.job_quotes`)).map((r) => r.k));
  const offered = new Map((await svc(`SELECT id, offered_to_helper_id FROM public.jobs`)).map((r) => [r.id, r.offered_to_helper_id]));
  const bad = [];
  let posterSide = 0;
  let quoterSide = 0;
  for (const r of rows) {
    if (r.title === "Finish setup to start") {
      if (!payoutRe.test(r.link) || !r.job_id || offered.get(r.job_id) !== r.user_id) bad.push(r);
      else quoterSide++;
      continue;
    }
    if (JOB_TITLES.has(r.title)) {
      const m = jobRe.exec(r.link);
      if (!m || m[1] !== r.job_id || offered.get(r.job_id) !== r.user_id) bad.push(r);
      else quoterSide++;
      continue;
    }
    const m = requestRe.exec(r.link);
    if (!m || r.job_id !== null || !reqs.has(m[1])) { bad.push(r); continue; }
    // What QuotesHubRedirect will decide at open time (quoteRequestTarget): the
    // request's poster gets its page, a quoter on it their quotes. The reader
    // must be one of the two, and on the side its title is meant for.
    const isPoster = reqs.get(m[1]) === r.user_id;
    const isQuoter = quoters.has(`${m[1]}:${r.user_id}`);
    if (!isPoster && !isQuoter) bad.push(r);
    else if (POSTER_TITLES.has(r.title) && !isPoster) bad.push(r);
    else if (QUOTER_TITLES.has(r.title) && !isQuoter) bad.push(r);
    else if (isPoster) posterSide++;
    else quoterSide++;
  }
  const seen = new Set(rows.map((r) => r.title));
  const missing = QUOTE_TITLES.filter((t) => !seen.has(t));
  check(
    "links: every quote notice carries a reference its reader's side is read from (request), or the job",
    rows.length > 20 && bad.length === 0 && missing.length === 0 && posterSide > 3 && quoterSide > 3,
    `rows=${rows.length} poster=${posterSide} quoter=${quoterSide} bad=${bad.length} ${bad.slice(0, 4).map((r) => `${r.title}->${r.link} job=${r.job_id}`).join(" | ")} missing=[${missing.join(", ")}]`,
    false,
    true,
  );
  const mails = await emails();
  const byId = new Map(rows.map((r) => [r.id, r.link]));
  const mailBad = mails.filter((b) => b.link !== byId.get(b.notification_id) ||
    !(requestRe.test(b.link) || jobRe.test(b.link) || payoutRe.test(b.link)));
  const quoterMails = mails.filter((b) => !POSTER_TITLES.has(b.title) && reqs.get(requestRe.exec(b.link ?? "")?.[1]) !== b.user_id);
  check(
    "links: each quote email carries its row's link (the quoter's included)",
    mails.length > 2 && quoterMails.length > 0 && mailBad.length === 0,
    `mails=${mails.length} toQuoter=${quoterMails.length} mismatched=${mailBad.length} ${quoterMails.slice(0, 2).map((b) => b.link).join(" | ")}`,
    false,
    true,
  );
  const acl = await svc(`SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS a, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('quote_notify_to', 'quote_notify_about', 'quote_notify')`);
  check(
    "links: quote_notify_to is the one notice helper and is not client-callable (the old two are dropped)",
    acl.length === 1 && acl[0].proname === "quote_notify_to" && !acl[0].a && !acl[0].u,
    JSON.stringify(acl),
    false,
    true,
  );
});

await step("grants: the new helpers and the sweep are not client-callable", async () => {
  const rows = await svc(`SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS a,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('quote_notify_about', 'quote_job_funded_hires_quoter', 'sweep_quote_alerts', 'quote_notify',
                        'quote_close_pending_across_block', 'quote_notify_to')`);
  // With LINKS applied, quote_notify_to replaces quote_notify_about and quote_notify (dropped).
  const want = LINKS_BEFORE ? 5 : 4;
  check("grants: the new helpers and the sweep are not client-callable", rows.length === want && rows.every((r) => !r.a && !r.u), JSON.stringify(rows));
});

// ---- Q2116: a paid quote job that does not hire its quoter tells the poster
const q16Check = (name, ok, detail) => check(name, ok, detail, false, false, false, true);
await step("Q2116 the quoter cannot decline an UNFUNDED offer (job_not_funded)", async () => {
  const { job } = await agreedJob(QA);
  const e = await err(QA, `SELECT public.respond_to_direct_offer('${job}', false)`);
  const j = (await svc(`SELECT direct_offer_status FROM public.jobs WHERE id = '${job}'`))[0];
  q16Check("Q2116 the quoter cannot decline an UNFUNDED offer (job_not_funded)", /job_not_funded/.test(e ?? "") && j.direct_offer_status === "pending", `${e} ${j.direct_offer_status}`);
});
await step("Q2116 money after the start: not hired, the reason is job_date_has_passed, the poster is told", async () => {
  const { job } = await agreedJob(QA);
  await svc(`UPDATE public.jobs SET date_needed = ((now() AT TIME ZONE 'America/Chicago') - interval '1 day')::date, start_time = NULL WHERE id = '${job}'`);
  await svc(`UPDATE public.jobs SET payment_status = 'escrow', stripe_payment_intent_id = 'pi_q16' WHERE id = '${job}'`);
  const j = (await svc(`SELECT helper_id FROM public.jobs WHERE id = '${job}'`))[0];
  const told = await svc(`SELECT title, message FROM public.notifications WHERE user_id = '${POSTER}' AND job_id = '${job}' AND title = 'Not booked yet'`);
  const logged = await svc(`SELECT context->>'block_reason' AS r FROM public.error_logs WHERE tags->>'job_id' = '${job}'`);
  q16Check("Q2116 money after the start: not hired, the reason is job_date_has_passed, the poster is told",
    j.helper_id === null && told.length === 1 && /after its start time/.test(told[0].message) && logged.some((r) => /job_date_has_passed/.test(r.r ?? "")),
    `helper=${j.helper_id} told=${told.length} logged=${JSON.stringify(logged)}`);
});
await step("Q2116 an unready quoter: the poster hears the job waits on their setup", async () => {
  await db.exec(`INSERT INTO public.stub_unready VALUES ('${QC}')`);
  const { job } = await agreedJob(QC);
  await svc(`UPDATE public.jobs SET payment_status = 'escrow', stripe_payment_intent_id = 'pi_q16b' WHERE id = '${job}'`);
  await db.exec(`DELETE FROM public.stub_unready`);
  const told = await svc(`SELECT message FROM public.notifications WHERE user_id = '${POSTER}' AND job_id = '${job}' AND title = 'Payment received'`);
  q16Check("Q2116 an unready quoter: the poster hears the job waits on their setup", told.length === 1 && /finishing their payout setup/.test(told[0].message), `told=${told.length}`);
});
await step("Q2116 the poster-notice helper is not client-callable", async () => {
  const rows = await svc(`SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS a, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u
    FROM pg_proc p WHERE p.proname = 'quote_job_tell_poster_not_hired'`);
  q16Check("Q2116 the poster-notice helper is not client-callable", rows.length === 1 && !rows[0].a && !rows[0].u, JSON.stringify(rows));
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${BEFORE ? "BEFORE (main only)" : LINKS_BEFORE ? "LINKS BEFORE (without " + LINKS + ")" : REMIND_BEFORE ? "REMIND BEFORE (without " + REMIND + ")" : REPLAY ? "AFTER (migrations x3)" : "AFTER (migrations x1)"}: ${results.length - failed}/${results.length} pass`);
// Links before: exactly the link checks fail; everything else holds.
// (REMIND builds on LINKS, so its checks fail there too.)
if (LINKS_BEFORE && !BEFORE) process.exit(results.every((r) => r.ok === !(r.links || r.remind || r.q16)) ? 0 : 1);
// Remind before: exactly the Q2120 checks fail (Q2116 builds on REMIND, so its checks fail there too).
if (REMIND_BEFORE && !BEFORE) process.exit(results.every((r) => r.ok === !(r.remind || r.q16)) ? 0 : 1);
// Q2116 before: exactly the Q2116 checks fail.
if (Q16_BEFORE && !BEFORE) process.exit(results.every((r) => r.ok === !r.q16) ? 0 : 1);
// Before: every behaviour check fails; the controls hold on main too.
if (BEFORE) process.exit(results.filter((r) => !r.control).every((r) => !r.ok) && results.filter((r) => r.control).every((r) => r.ok) ? 0 : 1);
process.exit(failed === 0 ? 0 : 1);

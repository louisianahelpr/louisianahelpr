#!/usr/bin/env node
/**
 * PGlite proof for 20261015091114_job_quotes.sql (quotes on jobs, slice 1;
 * owner decisions Q1-Q8 in docs/specs/louisiana-hub-roadmap.md).
 *
 *   npx tsx src/test/pglite/jobQuotes.pglite.mjs [--replay] [--before]
 *
 * --before leaves the migration out: every check must FAIL. Without it the
 * migration is applied (3x with --replay) and every check must PASS.
 *
 * Loaded from their EFFECTIVE definitions (src/test/helpers/effectiveFunctionDefs.ts):
 * require_feature, feature_enabled_for, contact_leak_reason, is_server_context,
 * enforce_jobs_insert_column_lock (the real jobs INSERT column lock, so the
 * booked job's payment_status / direct-offer markers are the real ones).
 * Stubs (not under test): feature_enabled_for_user (reads the switch row:
 * 'everyone' = on), is_caller_banned, member_under_18, are_users_blocked,
 * mask_job_location, seed_hidden_in_discovery; jobs is cut down to the columns
 * the lock and the booking touch, with the real jobs_budget_range CHECK.
 *
 *   Q1  switch off: every RPC refused; on: a request is created (48 h default,
 *       a 12 h window refused); "switch to my own price" posts an open,
 *       unoffered, UNPAID job and closes the quotes
 *   Q5  RLS: a quoter reads only their own quote, never another quoter's; a
 *       stranger reads nothing; nobody reads a request but its poster; no
 *       client INSERT/UPDATE; list_open_quote_requests carries no price,
 *       count or rank column and masks the address
 *   Q6  turns: nobody answers their own last offer; a counter moves the turn
 *       and resets 48 h; an expired offer cannot be accepted
 *   Q7  contact details refused in the note; own / duplicate / under-18 /
 *       banned / blocked quotes refused; the poster's notice names the quoter
 *       in its link (?user=, the seed boundary's actor)
 *   Q8  accept closes the other quotes; a second accept loses; the one-accepted
 *       index refuses a second accepted row; book_accepted_quote (poster only)
 *       inserts ONE unpaid job at the agreed price offered to the quoter,
 *       idempotently
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261015091114_job_quotes.sql";
// QUOTES_MIGRATION: a planted-defect copy, for the mutant runs in the report.
const MIGRATION = readFileSync(process.env.QUOTES_MIGRATION ?? DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

const DEFS = effectiveDefs(DIR, { before: THIS });
function fnStmt(name) {
  const d = DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
}

const POSTER = "00000000-0000-0000-0000-00000000000a";
const QA = "00000000-0000-0000-0000-00000000000b";
const QB = "00000000-0000-0000-0000-00000000000c";
const STRANGER = "00000000-0000-0000-0000-00000000000d";
const KID = "00000000-0000-0000-0000-00000000000e";
const BANNED = "00000000-0000-0000-0000-00000000000f";
const BLOCKED = "00000000-0000-0000-0000-000000000010";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users VALUES ('${POSTER}'),('${QA}'),('${QB}'),('${STRANGER}'),('${KID}'),('${BANNED}'),('${BLOCKED}');
GRANT USAGE ON SCHEMA public TO authenticated, anon;

CREATE TYPE public.job_category AS ENUM ('other', 'cleaning', 'yard_work');
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled');
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, avatar_url text, is_seed boolean NOT NULL DEFAULT false);
INSERT INTO public.profiles (user_id, full_name) VALUES ('${POSTER}','Poster'),('${QA}','Quoter A'),('${QB}','Quoter B');
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
  offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz
);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text,
  type text CHECK (type IN ('new_offers', 'info')), link text, job_id uuid);
CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text NOT NULL DEFAULT 'off', description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.stub_banned (user_id uuid PRIMARY KEY);
INSERT INTO public.stub_banned VALUES ('${BANNED}');
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE TABLE public.stub_blocks (a uuid, b uuid);
INSERT INTO public.stub_blocks VALUES ('${POSTER}', '${BLOCKED}');

CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_uid uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.feature_switches WHERE key = p_key AND audience = 'everyone') $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.stub_banned WHERE user_id = auth.uid()) $$;
CREATE FUNCTION public.member_under_18(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT p_user_id = '${KID}'::uuid $$;
CREATE FUNCTION public.are_users_blocked(_user_a uuid, _user_b uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.stub_blocks WHERE (a = _user_a AND b = _user_b) OR (a = _user_b AND b = _user_a)) $$;
CREATE FUNCTION public.mask_job_location(loc text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT CASE WHEN loc IS NULL THEN NULL ELSE 'Near ' || split_part(loc, ',', 2) END $$;
GRANT SELECT, UPDATE ON public.jobs TO authenticated;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
`);
for (const fn of ["feature_enabled_for", "require_feature", "contact_leak_reason", "is_server_context", "enforce_jobs_insert_column_lock"]) {
  await db.exec(fnStmt(fn));
}
await db.exec(`CREATE TRIGGER trg_jobs_insert_column_lock BEFORE INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_jobs_insert_column_lock();`);

if (!BEFORE) {
  for (let i = 0; i < (REPLAY ? 3 : 1); i++) await db.exec(MIGRATION);
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
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
const svc = async (sql) => (await db.query(sql)).rows;
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    check(name, false, `threw: ${String(e.message).slice(0, 160)}`);
  }
};
const REQ = (title = "Paint the fence", extra = "") =>
  `SELECT public.create_quote_request('${title}', 'Two coats on a 60 ft wooden fence', 'yard_work',
     (now() + interval '5 days')::date, NULL, 4, '12 Oak St, Metairie, LA', 29.98, -90.15, 'Jefferson'${extra}) AS id`;

// ---- switch off (Q1 behind 'quotes', created OFF)
await step("switch is created off and every RPC refuses", async () => {
  const sw = await svc("SELECT audience FROM public.feature_switches WHERE key = 'quotes'");
  const e = await err(POSTER, REQ());
  check("switch is created off and every RPC refuses", sw[0]?.audience === "off" && /feature_disabled/.test(e ?? ""), `${sw[0]?.audience} / ${e}`);
});
await db.exec("UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'quotes'");

let reqId, qa, qb, bookedJob;
await step("Q4 request: 48 h default, 12 h window refused", async () => {
  reqId = (await one(POSTER, REQ())).id;
  const r = (await svc(`SELECT window_hours, round(extract(epoch FROM quotes_close_at - created_at) / 3600) AS h, status FROM public.job_quote_requests WHERE id = '${reqId}'`))[0];
  const bad = await err(POSTER, REQ("Paint the shed", ", 12"));
  // A job tomorrow at 9:00 closes its 3-day window 2 h before the start; one
  // starting within the hour is refused (the posted-job start rule).
  const soon = (await one(POSTER, `SELECT public.create_quote_request('Paint the porch', 'Two coats on a small porch', 'other',
     ((now() AT TIME ZONE 'America/Chicago') + interval '1 day')::date, '09:00', NULL, NULL, NULL, NULL, NULL, 72) AS id`)).id;
  const capped = (await svc(`SELECT quotes_close_at = ((date_needed + start_time) AT TIME ZONE 'America/Chicago') - interval '2 hours' AS ok FROM public.job_quote_requests WHERE id = '${soon}'`))[0].ok;
  const tooSoon = await err(POSTER, `SELECT public.create_quote_request('Paint the door', 'One coat on a front door', 'other',
     (now() AT TIME ZONE 'America/Chicago')::date, ((now() AT TIME ZONE 'America/Chicago') + interval '90 minutes')::time)`);
  await svc(`UPDATE public.job_quote_requests SET status = 'cancelled' WHERE id = '${soon}'`);
  check("Q4 request: 48 h default, 12 h window refused", r.window_hours === 48 && Number(r.h) === 48 && r.status === "open" && /invalid_window/.test(bad ?? "") && capped === true && /job_start_too_soon/.test(tooSoon ?? ""), `${r.window_hours}/${r.h} ${bad} capped=${capped} ${tooSoon}`);
});

await step("Q7 quotes submitted; own / duplicate / under-18 / banned / blocked / contact refused", async () => {
  qa = (await one(QA, `SELECT public.submit_job_quote('${reqId}', 25000, 'Paint and brushes included', 'Saturday morning', ARRAY['${QA}/quotes/past1.jpg']) AS id`)).id;
  qb = (await one(QB, `SELECT public.submit_job_quote('${reqId}', 30000, 'Two coats, I bring the paint', 'Any weekday') AS id`)).id;
  const own = await err(POSTER, `SELECT public.submit_job_quote('${reqId}', 20000, 'x', 'y')`);
  const dup = await err(QA, `SELECT public.submit_job_quote('${reqId}', 20000, 'again', 'y')`);
  const kid = await err(KID, `SELECT public.submit_job_quote('${reqId}', 20000, 'hi', 'y')`);
  const ban = await err(BANNED, `SELECT public.submit_job_quote('${reqId}', 20000, 'hi', 'y')`);
  const blk = await err(BLOCKED, `SELECT public.submit_job_quote('${reqId}', 20000, 'hi', 'y')`);
  const leak = await err(STRANGER, `SELECT public.submit_job_quote('${reqId}', 20000, 'call me at 504-555-1234', 'y')`);
  const photo = await err(STRANGER, `SELECT public.submit_job_quote('${reqId}', 20000, 'ok', 'y', ARRAY['${QA}/theirs.jpg'])`);
  // Own folder but outside quotes/: refused too (the purge erases <uid>/quotes/ only).
  const photo2 = await err(STRANGER, `SELECT public.submit_job_quote('${reqId}', 20000, 'ok', 'y', ARRAY['${STRANGER}/reviews/x.jpg'])`);
  // Each row names its actor in the link, so the seed boundary can judge it (Q137).
  const notes = await svc(`SELECT count(*)::int AS n, count(*) FILTER (WHERE link IN ('/quotes?user=${QA}', '/quotes?user=${QB}'))::int AS actor
                             FROM public.notifications WHERE user_id = '${POSTER}'`);
  check(
    "Q7 quotes submitted; own / duplicate / under-18 / banned / blocked / contact refused",
    !!qa && !!qb && /cannot_quote_own/.test(own ?? "") && /already_quoted/.test(dup ?? "") && /under_18/.test(kid ?? "") &&
      /account_restricted/.test(ban ?? "") && /unknown_request/.test(blk ?? "") && /Phone number detected/.test(leak ?? "") &&
      /invalid_photo/.test(photo ?? "") && /invalid_photo/.test(photo2 ?? "") && notes[0].n === 2 && notes[0].actor === 2,
    [own, dup, kid, ban, blk, leak, photo, photo2].map((x) => (x ?? "ALLOWED").slice(0, 30)).join(" | "),
  );
});

await step("Q5 RLS: each quoter reads only their own quote; strangers nothing; requests poster-only; no client writes", async () => {
  const a = (await as(QA, "SELECT id, price_cents FROM public.job_quotes")).rows;
  const b = (await as(QB, "SELECT id FROM public.job_quotes")).rows;
  const p = (await as(POSTER, "SELECT id FROM public.job_quotes")).rows;
  const s = (await as(STRANGER, "SELECT id FROM public.job_quotes")).rows;
  const offersA = (await as(QA, "SELECT price_cents FROM public.job_quote_offers")).rows;
  const reqA = (await as(QA, "SELECT id FROM public.job_quote_requests")).rows;
  const reqP = (await as(POSTER, "SELECT id FROM public.job_quote_requests")).rows;
  const ins = await err(QA, `INSERT INTO public.job_quotes (request_id, quoter_id, price_cents, note, available_note, respond_until) VALUES ('${reqId}', '${QA}', 1000, 'x', 'y', now())`);
  const upd = await err(QA, `UPDATE public.job_quotes SET price_cents = 1000 WHERE id = '${qa}'`);
  check(
    "Q5 RLS: each quoter reads only their own quote; strangers nothing; requests poster-only; no client writes",
    a.length === 1 && a[0].id === qa && b.length === 1 && b[0].id === qb && p.length === 2 && s.length === 0 &&
      offersA.length === 1 && offersA[0].price_cents === 25000 && reqA.length === 0 && reqP.length === 2 &&
      /permission denied/.test(ins ?? "") && /permission denied/.test(upd ?? ""),
    `A:${a.length} B:${b.length} P:${p.length} S:${s.length} offersA:${offersA.length} reqA:${reqA.length} ins:${!!ins} upd:${!!upd}`,
  );
});

await step("Q5 open list: own status only, no price/count/rank column, address masked, own request hidden", async () => {
  const r = await as(QA, "SELECT * FROM public.list_open_quote_requests()");
  const cols = r.fields.map((f) => f.name);
  const row = r.rows.find((x) => x.id === reqId);
  const mine = (await as(POSTER, "SELECT * FROM public.list_open_quote_requests()")).rows;
  const leaky = cols.filter((c) => /price|count|rank|cents|budget|quoter/.test(c));
  await db.exec(`INSERT INTO public.ban_settlement_queue VALUES ('${POSTER}', 'open')`);
  const underReview = (await as(QA, "SELECT id FROM public.list_open_quote_requests()")).rows.length;
  await db.exec(`DELETE FROM public.ban_settlement_queue`);
  check(
    "Q5 open list: own status only, no price/count/rank column, address masked, own request hidden",
    !!row && row.my_quote_status === "pending" && leaky.length === 0 && !String(row.location).includes("12 Oak") && mine.length === 0 && underReview === 0,
    `underReview=${underReview} cols-leaky=${leaky} loc=${row?.location} posterSees=${mine.length}`,
  );
});

await step("Q6 turns: no answering your own offer; counter moves the turn and resets 48 h", async () => {
  const self = await err(QA, `SELECT public.respond_to_job_quote('${qa}', 'accept')`);
  const stranger = await err(STRANGER, `SELECT public.respond_to_job_quote('${qa}', 'decline')`);
  await svc(`UPDATE public.job_quotes SET respond_until = now() + interval '1 hour' WHERE id = '${qa}'`);
  const c = (await one(POSTER, `SELECT public.respond_to_job_quote('${qa}', 'counter', 22000, 'Can you do 220?') AS r`)).r;
  const q = (await svc(`SELECT price_cents, last_offer_side, offer_count, round(extract(epoch FROM respond_until - now()) / 3600) AS h FROM public.job_quotes WHERE id = '${qa}'`))[0];
  const posterAgain = await err(POSTER, `SELECT public.respond_to_job_quote('${qa}', 'accept')`);
  check(
    "Q6 turns: no answering your own offer; counter moves the turn and resets 48 h",
    /not_your_turn/.test(self ?? "") && /unknown_quote/.test(stranger ?? "") && c === "countered" && q.price_cents === 22000 &&
      q.last_offer_side === "poster" && q.offer_count === 2 && Number(q.h) === 48 && /not_your_turn/.test(posterAgain ?? ""),
    `${self} | ${stranger} | ${c} ${q.price_cents} ${q.last_offer_side} ${q.h}h | ${posterAgain}`,
  );
});

await step("Q6 an expired offer cannot be accepted and reads 'expired'", async () => {
  await svc(`UPDATE public.job_quotes SET respond_until = now() - interval '1 minute' WHERE id = '${qb}'`);
  const e = await err(POSTER, `SELECT public.respond_to_job_quote('${qb}', 'accept')`);
  const st = (await as(QB, "SELECT status FROM public.get_my_job_quotes()")).rows[0]?.status;
  await svc(`UPDATE public.job_quotes SET respond_until = now() + interval '48 hours' WHERE id = '${qb}'`);
  check("Q6 an expired offer cannot be accepted and reads 'expired'", /quote_expired/.test(e ?? "") && st === "expired", `${e} / ${st}`);
});

await step("Q8 accept: quoter accepts the counter, the other quote closes, a second accept loses", async () => {
  const a = (await one(QA, `SELECT public.respond_to_job_quote('${qa}', 'accept') AS r`)).r;
  const rows = await svc(`SELECT id, status FROM public.job_quotes WHERE request_id = '${reqId}' ORDER BY price_cents`);
  const req = (await svc(`SELECT status FROM public.job_quote_requests WHERE id = '${reqId}'`))[0];
  const second = await err(POSTER, `SELECT public.respond_to_job_quote('${qb}', 'accept')`);
  let backstop = null;
  try {
    await db.exec(`UPDATE public.job_quotes SET status = 'accepted' WHERE id = '${qb}'`);
  } catch (e) {
    backstop = String(e.message);
  }
  check(
    "Q8 accept: quoter accepts the counter, the other quote closes, a second accept loses",
    a === "accepted" && rows.find((r) => r.id === qa)?.status === "accepted" && rows.find((r) => r.id === qb)?.status === "closed" &&
      req.status === "agreed" && /quote_closed/.test(second ?? "") && /job_quotes_one_accepted|duplicate key/.test(backstop ?? ""),
    `${a} ${JSON.stringify(rows.map((r) => r.status))} ${req.status} | ${second} | ${backstop?.slice(0, 40)}`,
  );
});

await step("Q8 book: poster only, ONE unpaid job at the agreed price offered to the quoter, idempotent", async () => {
  const notPoster = await err(QA, `SELECT public.book_accepted_quote('${reqId}')`);
  const j1 = (await one(POSTER, `SELECT public.book_accepted_quote('${reqId}') AS id`)).id;
  const j2 = (await one(POSTER, `SELECT public.book_accepted_quote('${reqId}') AS id`)).id;
  bookedJob = j1;
  const job = (await svc(`SELECT budget, customer_id, offered_to_helper_id, direct_offer_status, payment_status, status, location FROM public.jobs WHERE id = '${j1}'`))[0];
  const n = (await svc("SELECT count(*)::int AS n FROM public.jobs"))[0].n;
  const mine = (await as(QA, "SELECT job_id FROM public.get_my_job_quotes()")).rows[0];
  check(
    "Q8 book: poster only, ONE unpaid job at the agreed price offered to the quoter, idempotent",
    /unknown_request/.test(notPoster ?? "") && j1 === j2 && Number(job.budget) === 220 && job.customer_id === POSTER &&
      job.offered_to_helper_id === QA && job.direct_offer_status === "pending" && job.payment_status === "unpaid" &&
      job.status === "open" && job.location === "12 Oak St, Metairie, LA" && n === 1 && mine?.job_id === j1,
    `${notPoster} | ${j1 === j2} ${job.budget} ${job.offered_to_helper_id === QA} ${job.direct_offer_status} ${job.payment_status} n=${n}`,
  );
});

await step("Q8 the booked job keeps the agreed price and details; the offer gets 48 h; agreed-but-unfunded can be cancelled", async () => {
  const lower = await err(POSTER, `UPDATE public.jobs SET budget = 10 WHERE id = '${bookedJob}'`);
  const retitle = await err(POSTER, `UPDATE public.jobs SET title = 'Something else' WHERE id = '${bookedJob}'`);
  const job = (await svc(`SELECT budget, round(extract(epoch FROM direct_offer_expires_at - now()) / 3600) AS h FROM public.jobs WHERE id = '${bookedJob}'`))[0];
  // A request agreed but never funded can be cancelled; a funded one cannot.
  const r7 = (await one(POSTER, REQ("Trim hedges"))).id;
  const q7 = (await one(QB, `SELECT public.submit_job_quote('${r7}', 5000, 'Front and back', 'Weekend') AS id`)).id;
  await one(POSTER, `SELECT public.respond_to_job_quote('${q7}', 'accept') AS r`);
  const j7 = (await one(POSTER, `SELECT public.book_accepted_quote('${r7}') AS id`)).id;
  await db.exec(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = '${j7}'`);
  const funded = await err(POSTER, `SELECT public.cancel_quote_request('${r7}')`);
  await db.exec(`UPDATE public.jobs SET payment_status = 'unpaid', stripe_session_id = 'cs_test_live' WHERE id = '${j7}'`);
  const liveCheckout = await err(POSTER, `SELECT public.cancel_quote_request('${r7}')`);
  await db.exec(`UPDATE public.jobs SET stripe_session_id = NULL WHERE id = '${j7}'`);
  await one(POSTER, `SELECT public.cancel_quote_request('${r7}') AS x`);
  const r7s = (await svc(`SELECT status FROM public.job_quote_requests WHERE id = '${r7}'`))[0].status;
  // Cancelling the agreed request must not lift the lock on its unpaid job (lh-authz-rls must-fix 2).
  const afterCancel = await err(POSTER, `UPDATE public.jobs SET budget = 10 WHERE id = '${j7}'`);
  const q7s = (await svc(`SELECT status FROM public.job_quotes WHERE id = '${q7}'`))[0].status;
  // Counters stop once the job could no longer be booked (2 h before the start).
  const r8 = (await one(POSTER, REQ("Rake leaves"))).id;
  const q8 = (await one(QB, `SELECT public.submit_job_quote('${r8}', 4000, 'Bags included', 'Today') AS id`)).id;
  await db.exec(`UPDATE public.job_quote_requests SET date_needed = (now() AT TIME ZONE 'America/Chicago')::date,
     start_time = ((now() AT TIME ZONE 'America/Chicago') + interval '90 minutes')::time WHERE id = '${r8}'`);
  const late = await err(POSTER, `SELECT public.respond_to_job_quote('${q8}', 'counter', 3000)`);
  const declineLate = await err(POSTER, `SELECT public.respond_to_job_quote('${q8}', 'decline')`);
  // From the hire on the lock steps aside for the schedule / detail change RPCs (M1).
  await db.exec(`UPDATE public.jobs SET helper_id = '${QB}' WHERE id = '${j7}'`);
  const hiredEdit = await err(POSTER, `UPDATE public.jobs SET start_time = '10:00' WHERE id = '${j7}'`);
  check(
    "Q8 the booked job keeps the agreed price and details; the offer gets 48 h; agreed-but-unfunded can be cancelled",
    /quote_terms_locked/.test(lower ?? "") && /quote_terms_locked/.test(retitle ?? "") && Number(job.budget) === 220 &&
      Number(job.h) === 48 && /request_booked/.test(funded ?? "") && r7s === "cancelled" && q7s === "closed" &&
      /job_start_too_soon/.test(late ?? "") && /quote_terms_locked/.test(afterCancel ?? "") &&
      /checkout_open/.test(liveCheckout ?? "") && hiredEdit === null && declineLate === null,
    `live=${liveCheckout?.slice(0, 16)} hired=${hiredEdit} decl=${declineLate} | ${afterCancel?.slice(0, 20)} | ${lower?.slice(0, 30)} | ${retitle?.slice(0, 30)} | ${job.budget} ${job.h}h | ${funded} | ${r7s} ${q7s} | ${late}`,
  );
});

await step("Q1 switch to my own price: quotes close, an open unoffered UNPAID job at the poster's price", async () => {
  const r2 = (await one(POSTER, REQ("Mow the lawn"))).id;
  const q = (await one(QB, `SELECT public.submit_job_quote('${r2}', 6000, 'Mow and edge', 'Tomorrow') AS id`)).id;
  const notPoster = await err(QB, `SELECT public.switch_quote_request_to_set_price('${r2}', 50)`);
  const j = (await one(POSTER, `SELECT public.switch_quote_request_to_set_price('${r2}', 50) AS id`)).id;
  const job = (await svc(`SELECT budget, offered_to_helper_id, payment_status, status FROM public.jobs WHERE id = '${j}'`))[0];
  const qs = (await svc(`SELECT status FROM public.job_quotes WHERE id = '${q}'`))[0].status;
  const rs = (await svc(`SELECT status, job_id FROM public.job_quote_requests WHERE id = '${r2}'`))[0];
  const late = await err(STRANGER, `SELECT public.submit_job_quote('${r2}', 6000, 'late', 'now')`);
  check(
    "Q1 switch to my own price: quotes close, an open unoffered UNPAID job at the poster's price",
    /unknown_request/.test(notPoster ?? "") && Number(job.budget) === 50 && job.offered_to_helper_id === null &&
      job.payment_status === "unpaid" && job.status === "open" && qs === "closed" && rs.status === "closed" && rs.job_id === j &&
      /quotes_closed/.test(late ?? ""),
    `${notPoster} | ${job.budget} ${job.offered_to_helper_id} ${job.payment_status} | ${qs} ${rs.status} | ${late}`,
  );
});

await step("cancel closes pending quotes; a quote after the window is refused; withdraw is the quoter's only", async () => {
  const r3 = (await one(POSTER, REQ("Wash windows"))).id;
  const q = (await one(QA, `SELECT public.submit_job_quote('${r3}', 8000, 'Inside and out', 'Friday') AS id`)).id;
  const wNot = await err(QB, `SELECT public.withdraw_job_quote('${q}')`);
  await one(POSTER, `SELECT public.cancel_quote_request('${r3}') AS x`);
  const qs = (await svc(`SELECT status FROM public.job_quotes WHERE id = '${q}'`))[0].status;
  const r4 = (await one(POSTER, REQ("Clean gutters"))).id;
  await svc(`UPDATE public.job_quote_requests SET quotes_close_at = now() - interval '1 second' WHERE id = '${r4}'`);
  const late = await err(QA, `SELECT public.submit_job_quote('${r4}', 8000, 'ok', 'Friday')`);
  check(
    "cancel closes pending quotes; a quote after the window is refused; withdraw is the quoter's only",
    /unknown_quote/.test(wNot ?? "") && qs === "closed" && /quotes_closed/.test(late ?? ""),
    `${wNot} | ${qs} | ${late}`,
  );
});

await step("account deletion: the poster's address goes, an open request stops; a deleted quoter's pending quote is withdrawn", async () => {
  const r5 = (await one(POSTER, REQ("Haul a sofa"))).id;
  const q5 = (await one(QB, `SELECT public.submit_job_quote('${r5}', 9000, 'Truck and two people', 'Sunday') AS id`)).id;
  const r6 = (await one(POSTER, REQ("Fix a gate"))).id;
  const q6 = (await one(QA, `SELECT public.submit_job_quote('${r6}', 7000, 'Hinges included', 'Monday') AS id`)).id;
  await db.exec(`DELETE FROM public.profiles WHERE user_id = '${QA}'; DELETE FROM auth.users WHERE id = '${QA}';`);
  const q6s = (await svc(`SELECT status, quoter_id, note, photo_paths FROM public.job_quotes WHERE id = '${q6}'`))[0];
  const q6offers = (await svc(`SELECT count(*)::int AS n FROM public.job_quote_offers WHERE quote_id = '${q6}' AND note IS NOT NULL`))[0].n;
  const r9 = (await one(POSTER, REQ("Move a fridge"))).id;
  const q9 = (await one(QB, `SELECT public.submit_job_quote('${r9}', 6000, 'Dolly included', 'Monday') AS id`)).id;
  await one(POSTER, `SELECT public.respond_to_job_quote('${q9}', 'accept') AS r`);
  await db.exec(`DELETE FROM public.profiles WHERE user_id = '${POSTER}'; DELETE FROM auth.users WHERE id = '${POSTER}';`);
  const r5s = (await svc(`SELECT status, location, latitude, poster_id FROM public.job_quote_requests WHERE id = '${r5}'`))[0];
  const q5s = (await svc(`SELECT status FROM public.job_quotes WHERE id = '${q5}'`))[0].status;
  const listed = (await as(QB, "SELECT id FROM public.list_open_quote_requests()")).rows.length;
  const r9s = (await svc(`SELECT r.status AS rs, q.status AS qs FROM public.job_quote_requests r JOIN public.job_quotes q ON q.request_id = r.id WHERE r.id = '${r9}'`))[0];
  check(
    "account deletion: the poster's address goes, an open request stops; a deleted quoter's pending quote is withdrawn",
    q6s.status === "withdrawn" && q6s.quoter_id === null && q6s.note === "Removed" && q6s.photo_paths.length === 0 && q6offers === 0 &&
      r9s.rs === "cancelled" && r9s.qs === "closed" && r5s.poster_id === null && r5s.location === null &&
      r5s.latitude === null && r5s.status === "cancelled" && q5s === "closed" && listed === 0,
    `${q6s.status} ${q6s.note} offers=${q6offers} | agreed->${r9s.rs}/${r9s.qs} | ${r5s.status} ${r5s.location} | ${q5s} | listed=${listed}`,
  );
});

await step("grants: no anon EXECUTE on any quote RPC; helpers not client-callable", async () => {
  const rows = await svc(`SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('create_quote_request','list_open_quote_requests','submit_job_quote','respond_to_job_quote',
        'book_accepted_quote','switch_quote_request_to_set_price','cancel_quote_request','withdraw_job_quote',
        'get_my_quote_requests','get_quotes_for_request','get_my_job_quotes','quote_insert_job','quote_require_member','quote_notify')`);
  const helpers = ["quote_insert_job", "quote_require_member", "quote_notify"];
  const bad = rows.filter((r) => r.anon_x || (helpers.includes(r.proname) ? r.auth_x : !r.auth_x));
  check("grants: no anon EXECUTE on any quote RPC; helpers not client-callable", rows.length === 14 && bad.length === 0, `rows=${rows.length} bad=${bad.map((r) => r.proname)}`);
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${BEFORE ? "BEFORE (no migration)" : REPLAY ? "AFTER (migration x3)" : "AFTER (migration x1)"}: ${results.length - failed}/${results.length} pass`);
if (BEFORE) process.exit(failed === results.length ? 0 : 1);
process.exit(failed === 0 ? 0 : 1);

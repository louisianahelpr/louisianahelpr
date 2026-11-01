#!/usr/bin/env node
/**
 * PGlite proof for 20261101063725_instant_book_floors.sql (CMP-4 slice 1: a
 * Helpr's private auto-accept floor, and the poster's "who would take it at my
 * price" list).
 *
 *   node src/test/pglite/instantBookFloors.pglite.mjs                       # GREEN, migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/instantBookFloors.pglite.mjs    # RED: every check fails on today's code
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/instantBookFloors.pglite.mjs   # a planted defect must turn a check red
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Tables carry the real column names (jobs: the live list used by
 * cardHoldAtPost.pglite.mjs; helper_availability: 20260311013311; reviews and
 * profiles: src/integrations/supabase/types.ts). The feature-switch registry is
 * the real 20261012031120; job_payment_is_listed is its newest definition.
 * Helpers not under test are stubs driven by tables (_ready, _banned, _shadow, _blocked).
 *
 *   F1  on for everyone: no 'instant_book' switch row; an ordinary account sets and reads its own floors; anon cannot call the RPCs
 *   F2  nobody but service_role touches instant_book_floors directly (the owner included)
 *   F3  set: a banned member, bad category, out-of-range floor and a 4th category are refused; a change updates; NULL removes
 *   F4  rpc_my_instant_book_floors returns only the caller's own floors
 *   F5  candidates: only the job's poster may ask; the list never carries a floor or a price column
 *   F6  candidates: the qualifying Helprs, best first (rating, then jobs done), at most 3
 *   F7  a floor above the job's price, or no floor for the category, keeps a Helpr off the list
 *   F8  free day: no availability row = not free; a specific_date row overrides the weekly row both ways
 *   F9  only REAL completed jobs count toward the 3 (not is_seed, poster not a test account)
 *   F10 payout/ID not ready, banned, shadowbanned, blocked: off the list
 *   F11 test and real never mix: a test Helpr is never offered on a real job, a real Helpr never on a test job
 *   F12 a job that is not funded, already offered, or has no date gives an empty list
 *   F13 the block-reason, free-day and jobs-done helpers are not callable by members
 */
import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261101063725_instant_book_floors.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const REGISTRY = readFileSync(`${DIR}20261012031120_hidden_feature_switches.sql`, "utf8");

/** The newest CREATE FUNCTION of `name` in a migration BEFORE this one, any dollar tag. */
function priorNewest(name) {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < THIS).sort();
  const head = new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?${name}"?[\s(]`, "gi");
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = readFileSync(DIR + files[i], "utf8");
    const starts = [...sql.matchAll(head)];
    if (!starts.length) continue;
    const rest = sql.slice(starts[starts.length - 1].index);
    const tag = /\bas\s+(\$[A-Za-z_]*\$)/i.exec(rest);
    const close = rest.indexOf(tag[1], tag.index + tag[0].length);
    return rest.slice(0, rest.indexOf(";", close + tag[1].length) + 1).replace(/^create\s+function/i, "CREATE OR REPLACE FUNCTION");
  }
  throw new Error(`no function ${name} before ${THIS}`);
}

const JOB_COLUMNS = readFileSync(new URL("./cardHoldAtPost.pglite.mjs", import.meta.url), "utf8").match(/const JOB_COLUMNS = `([\s\S]*?)`;/)[1];

const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; -- as prod
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled', 'revision_requested', 'disputed', 'pending_approval');
CREATE TYPE public.job_category AS ENUM ('cleaning', 'yard_work', 'moving', 'errands', 'handyman', 'painting', 'delivery', 'pet_care', 'assembly', 'other', 'storm_prep', 'events', 'electrical', 'plumbing', 'hvac', 'roofing', 'welding', 'carpentry', 'auto_repair', 'appliance_repair', 'flooring', 'concrete_masonry', 'fencing', 'pressure_washing', 'declutter_help');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.jobs (${JOB_COLUMNS});
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, avatar_url text, ban_status text, auto_suspended_until timestamptz,
  date_of_birth date, is_seed boolean DEFAULT false);
CREATE TABLE public.helper_availability (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helper_id uuid NOT NULL, day_of_week integer,
  specific_date date, start_time time, end_time time, is_available boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL, reviewer_id uuid, reviewee_id uuid NOT NULL,
  rating integer NOT NULL, feedback text, feedback_visible_at timestamptz, photo_urls text[], response_at timestamptz, response_text text,
  status text NOT NULL DEFAULT 'published', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public._ready (user_id uuid PRIMARY KEY);
CREATE TABLE public._shadow (user_id uuid PRIMARY KEY);
CREATE TABLE public._blocked (a uuid, b uuid);
-- helpers the bodies call that are not under test
CREATE FUNCTION public.helper_accept_block_reason(p uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public._ready r WHERE r.user_id = p) THEN NULL ELSE 'helper_payout_setup_incomplete' END $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.ban_status = 'banned') $$;
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public._blocked x WHERE (x.a = $1 AND x.b = $2) OR (x.a = $2 AND x.b = $1)) $$;
CREATE FUNCTION public.member_display_name(n text, fallback text DEFAULT 'A neighbor') RETURNS text LANGUAGE sql STABLE AS $$ SELECT COALESCE(n, fallback) $$;
CREATE FUNCTION public.job_offer_cutoff(d date, t time) RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT (d + COALESCE(t, time '23:59'))::timestamptz $$;
CREATE FUNCTION public.get_user_credential_tier(u uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.is_helper_shadowbanned(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public._shadow s WHERE s.user_id = u) $$;
`;

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const TP = id(1); // a test-account poster
const RP = id(2); // a real poster, for the Helprs' job history
const ORD = id(3); // an ordinary account
const TP2 = id(4); // another tester
// Helprs (real accounts unless named T*)
const A = id(11), B = id(12), C = id(13), D = id(14); // qualify (D is the 4th, cut by LIMIT 3)
const HIGH = id(21); // floor above the price
const OTHERCAT = id(22); // floor only for another category
const NOAVAIL = id(23); // no availability row
const DAYOFF = id(24); // weekly yes, specific_date no
const DAYON = id(25); // no weekly row, specific_date yes -> qualifies
const FEWJOBS = id(26); // 2 real + seed + test-poster jobs
const UNREADY = id(27), BANNED = id(28), SHADOW = id(29), BLOCKED = id(30);
const TH = id(31); // a test-account Helpr

const QUALIFY = [A, B, C, D, DAYON];
const ALL_H = [...QUALIFY, HIGH, OTHERCAT, NOAVAIL, DAYOFF, FEWJOBS, UNREADY, BANNED, SHADOW, BLOCKED, TH];

const J = { real: id(101), seed: id(102), unpaid: id(103), offered: id(104), nodate: id(105), other: id(106) };

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(REGISTRY);
await db.exec("SET check_function_bodies = off;");
await db.exec(priorNewest("job_payment_is_listed"));
await db.exec(`INSERT INTO auth.users (id) SELECT unnest(ARRAY[${[TP, RP, ORD, TP2, ...ALL_H].map((u) => `'${u}'::uuid`).join(",")}]);
  INSERT INTO public.test_accounts (user_id) VALUES ('${TP}'), ('${TP2}'), ('${TH}');
  INSERT INTO public.profiles (user_id, full_name, is_seed) SELECT u, 'P' || right(u::text, 2), u IN ('${TP}', '${TP2}', '${TH}')
    FROM unnest(ARRAY[${[TP, RP, ORD, TP2, ...ALL_H].map((u) => `'${u}'::uuid`).join(",")}]) u;
  UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${BANNED}';
  INSERT INTO public._ready SELECT unnest(ARRAY[${ALL_H.filter((h) => h !== UNREADY).map((u) => `'${u}'::uuid`).join(",")}]);
  INSERT INTO public._shadow VALUES ('${SHADOW}');
  INSERT INTO public._blocked VALUES ('${TP}', '${BLOCKED}');`);

if (!SKIP) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
}
await db.exec("SET check_function_bodies = on;");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (ok) pass++; else fail++;
};
async function as(who, uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET request.jwt.claim.role = '${who}'; SET ROLE ${who};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE; SET request.jwt.claim.sub = ''; SET request.jwt.claim.role = '';`);
  }
}
async function owner(sql) {
  try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e) }; }
}
const err = (r) => (r && !Array.isArray(r) ? r.error : "");
const ok = (r) => Array.isArray(r);

// ─── the world ──────────────────────────────────────────────────────────────
const day = "current_date + 2";
const dow = `extract(dow FROM ${day})::int`;
// Jobs the poster asks about: $60 yard work, funded, two days out.
const job = (jid, extra = "", cols = "") => owner(`INSERT INTO public.jobs (id, customer_id, title, description, category, date_needed, budget, payment_status${cols})
  VALUES ('${jid}', '${TP}', 'Mow', 'd', 'yard_work', ${day}, 60, 'escrow'${extra})`);
await job(J.real);
await job(J.seed, ", true", ", is_seed");
await job(J.unpaid);
await owner(`UPDATE public.jobs SET payment_status = 'unpaid' WHERE id = '${J.unpaid}'`);
await job(J.offered, `, '${A}', 'pending'`, ", offered_to_helper_id, direct_offer_status");
await job(J.nodate);
await owner(`UPDATE public.jobs SET date_needed = NULL WHERE id = '${J.nodate}'`);
await owner(`INSERT INTO public.jobs (id, customer_id, title, description, category, date_needed, budget, payment_status) VALUES ('${J.other}', '${TP2}', 'x', 'd', 'yard_work', ${day}, 60, 'escrow')`);

// History: each Helpr gets three real completed jobs; FEWJOBS gets two real ones plus a seed job and a test poster's job.
let n = 1000;
const done = async (h, cust = RP, seed = false) => {
  const jid = id(n++);
  await owner(`INSERT INTO public.jobs (id, customer_id, helper_id, title, description, category, budget, status, payment_status, is_seed)
    VALUES ('${jid}', '${cust}', '${h}', 'old', 'd', 'yard_work', 50, 'completed', 'released', ${seed})`);
  return jid;
};
for (const h of ALL_H.filter((x) => x !== FEWJOBS)) for (let i = 0; i < 3; i++) await done(h, h === TH ? TP2 : RP, h === TH);
await done(FEWJOBS); await done(FEWJOBS); await done(FEWJOBS, RP, true); await done(FEWJOBS, TP2);
// D gets one more real job than the others (it wins the tie-break with B). Ratings: A 5, B 4, C 3, D 4, DAYON none.
const dj = await done(D);
const rate = async (h, r) => owner(`INSERT INTO public.reviews (job_id, reviewee_id, rating) VALUES ('${dj}', '${h}', ${r})`);
await rate(A, 5); await rate(B, 4); await rate(C, 3); await rate(D, 4);
await rate(HIGH, 5); await rate(TH, 5);

// Availability: everyone free on the weekly day except NOAVAIL (nothing), DAYOFF (date says no), DAYON (date only).
for (const h of ALL_H.filter((x) => ![NOAVAIL, DAYON].includes(x))) await owner(`INSERT INTO public.helper_availability (helper_id, day_of_week, is_available) VALUES ('${h}', ${dow}, true)`);
await owner(`INSERT INTO public.helper_availability (helper_id, specific_date, is_available) VALUES ('${DAYOFF}', ${day}, false), ('${DAYON}', ${day}, true)`);

// Floors, set by each Helpr through the RPC (on for everyone: no switch, no enrolment).
const setFloor = (h, cat, cents) => as("authenticated", h, `SELECT public.rpc_set_instant_book_floor('${cat}', ${cents})`);
const setRes = [];
for (const h of ALL_H.filter((x) => ![HIGH, OTHERCAT, BANNED].includes(x))) setRes.push(await setFloor(h, "yard_work", 5000));
// A banned member cannot set a floor; one set before the ban stays on the table (written as the owner here).
const bannedSet = await setFloor(BANNED, "yard_work", 5000);
await owner(`INSERT INTO public.instant_book_floors (helper_id, category, floor_cents) VALUES ('${BANNED}', 'yard_work', 5000)`);
setRes.push(await setFloor(A, "yard_work", 6000)); // change: exactly the price still clears
setRes.push(await setFloor(HIGH, "yard_work", 6001));
setRes.push(await setFloor(OTHERCAT, "cleaning", 1000));

// ─── F3 set rules ──────────────────────────────────────────────────────────
const badCat = await setFloor(B, "not_a_category", 2000);
const low = await setFloor(B, "cleaning", 999);
const high = await setFloor(B, "cleaning", 100001);
const c2 = await setFloor(B, "cleaning", 2000);
const c3 = await setFloor(B, "moving", 2000);
const c4 = await setFloor(B, "painting", 2000);
const del = await setFloor(B, "moving", "NULL");
const c4b = await setFloor(B, "painting", 2000);
const bRows = await owner(`SELECT category::text AS c, floor_cents FROM public.instant_book_floors WHERE helper_id = '${B}' ORDER BY 1`);
const aRow = await owner(`SELECT floor_cents FROM public.instant_book_floors WHERE helper_id = '${A}' AND category = 'yard_work'`);
check("F3 set: a banned member, bad category, out-of-range floor and a 4th category are refused; a change updates; NULL removes",
  setRes.every(ok) && /account_restricted/.test(err(bannedSet)) && /invalid_category/.test(err(badCat)) && /floor_out_of_range/.test(err(low)) && /floor_out_of_range/.test(err(high))
    && ok(c2) && ok(c3) && /too_many_categories/.test(err(c4)) && ok(del) && ok(c4b)
    && ok(bRows) && bRows.map((r) => r.c).join(",") === "cleaning,painting,yard_work" && ok(aRow) && aRow[0]?.floor_cents === 6000,
  [setRes.map(err).filter(Boolean)[0], err(badCat), err(low), err(c4), JSON.stringify(bRows)].filter(Boolean).join(" | "));

// ─── F4 own floors only ─────────────────────────────────────────────────────
const mine = await as("authenticated", B, `SELECT * FROM public.rpc_my_instant_book_floors()`);
check("F4 rpc_my_instant_book_floors returns only the caller's own floors",
  ok(mine) && mine.length === 3 && mine.every((r) => typeof r.floor_cents === "number"), err(mine) || JSON.stringify(mine));
await owner(`DELETE FROM public.instant_book_floors WHERE helper_id = '${B}' AND category <> 'yard_work'`);

// ─── F1 switch and refusal ──────────────────────────────────────────────────
const sw = await owner(`SELECT audience FROM public.feature_switches WHERE key = 'instant_book'`);
const r1 = await as("authenticated", ORD, `SELECT public.rpc_set_instant_book_floor('yard_work', 2000)`);
const r2 = await as("authenticated", ORD, `SELECT * FROM public.rpc_my_instant_book_floors()`);
const r4 = await as("anon", null, `SELECT * FROM public.instant_book_candidates('${J.real}')`);
const r5 = await as("anon", null, `SELECT public.rpc_set_instant_book_floor('yard_work', 2000)`);
await owner(`DELETE FROM public.instant_book_floors WHERE helper_id = '${ORD}'`);
check("F1 on for everyone: no 'instant_book' switch row; an ordinary account sets and reads its own floor; anon cannot call the RPCs",
  ok(sw) && sw.length === 0 && ok(r1) && ok(r2) && r2.length === 1 && r2[0].floor_cents === 2000
    && /permission denied/.test(err(r4)) && /permission denied/.test(err(r5)),
  [JSON.stringify(sw), err(r1), err(r2) || JSON.stringify(r2), err(r4), err(r5)].join(" | "));

// ─── F2 direct table access ─────────────────────────────────────────────────
const t1 = await as("authenticated", A, `SELECT * FROM public.instant_book_floors`);
const t2 = await as("authenticated", A, `INSERT INTO public.instant_book_floors (helper_id, category, floor_cents) VALUES ('${A}', 'moving', 2000)`);
const t3 = await as("authenticated", A, `UPDATE public.instant_book_floors SET floor_cents = 1000 WHERE helper_id = '${A}'`);
const t4 = await as("anon", null, `SELECT * FROM public.instant_book_floors`);
const t5 = await as("service_role", null, `SELECT count(*)::int AS n FROM public.instant_book_floors`);
const rls = await owner(`SELECT relrowsecurity AS on, (SELECT count(*)::int FROM pg_policies WHERE tablename = 'instant_book_floors') AS policies FROM pg_class WHERE relname = 'instant_book_floors'`);
check("F2 no member (the owner included) or guest reads or writes instant_book_floors; RLS on with no policy",
  [t1, t2, t3, t4].every((r) => /permission denied/.test(err(r))) && ok(t5) && t5[0].n > 0 && ok(rls) && rls[0]?.on === true && rls[0]?.policies === 0,
  [err(t1), err(t2), err(t3), err(t4), err(t5) || JSON.stringify(t5), JSON.stringify(rls)].join(" | "));

// ─── F5..F11 the poster's list ─────────────────────────────────────────────
const list = await as("authenticated", TP, `SELECT * FROM public.instant_book_candidates('${J.real}')`);
const notMine = await as("authenticated", TP2, `SELECT * FROM public.instant_book_candidates('${J.real}')`);
const cols = await owner(`SELECT string_agg(a, ',') AS c FROM unnest((SELECT proargnames FROM pg_proc WHERE proname = 'instant_book_candidates')) a`);
check("F5 only the job's poster may ask; the list carries no floor or price column",
  ok(list) && /not_authorized/.test(err(notMine)) && ok(cols) && !/floor|price|cents|budget/i.test(cols[0]?.c ?? "floor")
    && list.every((r) => !Object.keys(r).some((k) => /floor|cents|price/i.test(k))),
  err(list) || err(notMine) || cols[0]?.c);

// Ranking: A (rating 5.0) first; D and B tie on 4.0 and D has more real jobs done; C (3.0) and DAYON (no rating) are cut.
const full = await owner(`SELECT f.helper_id FROM public.instant_book_floors f WHERE public.instant_book_block_reason('${J.real}', f.helper_id) IS NULL ORDER BY 1`);
const ids = ok(list) ? list.map((r) => r.helper_id) : [];
check("F6 the qualifying Helprs, best first (rating, then jobs done), at most 3",
  ids.join(",") === [A, D, B].join(",") && ok(full) && full.map((r) => r.helper_id).sort().join(",") === [...QUALIFY].sort().join(","),
  `list ${ids.map((x) => x.slice(-2)).join(",")}; qualify ${ok(full) ? full.map((r) => r.helper_id.slice(-2)).join(",") : err(full)}`);

const reason = async (h, jid = J.real) => (await owner(`SELECT public.instant_book_block_reason('${jid}', '${h}') AS r`))[0]?.r;
check("F7 a floor above the job's price, or no floor for the category, keeps a Helpr off the list",
  (await reason(HIGH)) === "not_eligible" && (await reason(OTHERCAT)) === "not_eligible" && (await reason(A)) === null);
check("F8 free day: no row = not free; a specific_date row overrides the weekly row both ways",
  (await reason(NOAVAIL)) === "not_eligible" && (await reason(DAYOFF)) === "not_eligible" && (await reason(DAYON)) === null);
const fewDone = await owner(`SELECT public.instant_book_real_jobs_done('${FEWJOBS}') AS n`);
check("F9 only REAL completed jobs count toward the 3 (a seed job and a test poster's job do not)",
  ok(fewDone) && fewDone[0].n === 2 && (await reason(FEWJOBS)) === "not_eligible", JSON.stringify(fewDone));
check("F10 payout/ID not ready, banned, shadowbanned, blocked: off the list",
  (await Promise.all([UNREADY, BANNED, SHADOW, BLOCKED].map((h) => reason(h)))).every((r) => r === "not_eligible"));

// Test and real: TH is a test account with a floor and 3 completed (test) jobs.
await owner(`INSERT INTO public.jobs (id, customer_id, helper_id, title, description, category, budget, status, payment_status) VALUES
  ('${id(1999)}', '${RP}', '${TH}', 'a', 'd', 'yard_work', 50, 'completed', 'released'), ('${id(1998)}', '${RP}', '${TH}', 'b', 'd', 'yard_work', 50, 'completed', 'released'),
  ('${id(1997)}', '${RP}', '${TH}', 'c', 'd', 'yard_work', 50, 'completed', 'released')`);
const seedList = await as("authenticated", TP, `SELECT * FROM public.instant_book_candidates('${J.seed}')`);
check("F11 test and real never mix: a test Helpr is never offered on a real job, a real Helpr never on a test job",
  (await reason(TH)) === "not_eligible" && (await reason(A, J.seed)) === "not_eligible" && (await reason(TH, J.seed)) === null
    && ok(seedList) && seedList.map((r) => r.helper_id).join(",") === TH && !ids.includes(TH),
  err(seedList) || JSON.stringify(seedList));

const empties = [];
for (const jid of [J.unpaid, J.offered, J.nodate]) empties.push(await as("authenticated", TP, `SELECT * FROM public.instant_book_candidates('${jid}')`));
check("F12 a job that is not funded, already offered, or has no date gives an empty list",
  empties.every((r) => ok(r) && r.length === 0) && (await reason(A, J.unpaid)) === "job_not_funded" && (await reason(A, J.offered)) === "job_not_open"
    && (await reason(A, J.nodate)) === "job_has_no_date",
  empties.map((r) => err(r) || r.length).join(","));

const h1 = await as("authenticated", TP, `SELECT public.instant_book_block_reason('${J.real}', '${A}')`);
const h2 = await as("authenticated", TP, `SELECT public.instant_book_helper_free_on('${A}', current_date)`);
const h3 = await as("authenticated", TP, `SELECT public.instant_book_real_jobs_done('${A}')`);
check("F13 the block-reason, free-day and jobs-done helpers are not callable by members",
  [h1, h2, h3].every((r) => /permission denied/.test(err(r))), [h1, h2, h3].map((r) => err(r) || "allowed").join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

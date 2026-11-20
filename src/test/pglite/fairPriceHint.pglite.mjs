#!/usr/bin/env node
/**
 * PGlite proof for 20261120205106_fair_price_hint.sql (owner 2026-11-20, ease batch item 1).
 *
 *   node src/test/pglite/fairPriceHint.pglite.mjs
 *
 * The migration applied 3x (replay), on top of a stub get_price_guidance + the 'price_guidance' switch (both retired by
 * it). auth.uid() is a stub. Checks: with no real data a signed-in member gets the 'typical' range; 4 near jobs stay
 * typical (needs 5); 5 near jobs from 3 posters give 'near' (middle half, whole dollars); 5 near jobs from 2 posters stay
 * thin; far jobs only count statewide ('state'); seed, test-account and seed-profile posters, crew jobs, cancelled,
 * never-paid, old and other-category jobs never count; a guest (anon) only ever gets 'typical' even with real data;
 * an unknown category returns no row; anon and authenticated can EXECUTE, PUBLIC cannot; fair_price_typical is not
 * client-callable; get_price_guidance and the switch row are gone.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const SQL = readFileSync(new URL("../../../supabase/migrations/20261120205106_fair_price_hint.sql", import.meta.url).pathname, "utf8");

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = U(1), TEST = U(2), SEEDP = U(3);
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text, description text);
  INSERT INTO public.feature_switches VALUES ('price_guidance', 'testers', 'old');
  CREATE FUNCTION public.get_price_guidance(p_category text) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
  CREATE TYPE public.job_category AS ENUM ('yard_work', 'cleaning');
  CREATE TYPE public.job_status AS ENUM ('open', 'completed', 'cancelled');
  CREATE TABLE public.jobs (id serial PRIMARY KEY, category public.job_category, budget numeric, status public.job_status,
    payment_status text, created_at timestamptz, is_seed boolean, is_group_job boolean, customer_id uuid, helper_id uuid,
    latitude double precision, longitude double precision);
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean);
  INSERT INTO public.test_accounts VALUES ('${TEST}');
  INSERT INTO public.profiles VALUES ('${SEEDP}', true);
`);
for (let i = 0; i < 3; i++) await db.exec(SQL);

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
// Lafayette, LA; "far" is New Orleans (~120 miles).
const HERE = [30.22, -92.02], FAR = [29.95, -90.07];
const ask = async (uid = ME, cat = "yard_work", at = HERE) => {
  await db.exec(`SET test.uid = '${uid ?? ""}'`);
  const loc = at ? `${at[0]}, ${at[1]}` : "NULL, NULL";
  return (await db.query(`SELECT * FROM public.get_fair_price_hint('${cat}', ${loc})`)).rows[0];
};
let seq = 0;
const job = (budget, extra = {}) => {
  const j = { category: "yard_work", status: "open", payment_status: "paid", age: "1 day", is_seed: false, is_group_job: false,
    customer_id: U(60 + (seq++ % 3)), helper_id: null, at: HERE, ...extra };
  return db.exec(`INSERT INTO public.jobs (category, budget, status, payment_status, created_at, is_seed, is_group_job, customer_id, helper_id, latitude, longitude)
    VALUES ('${j.category}', ${budget}, '${j.status}', '${j.payment_status}', now() - interval '${j.age}', ${j.is_seed}, ${j.is_group_job},
      '${j.customer_id}', ${j.helper_id ? `'${j.helper_id}'` : "NULL"}, ${j.at[0]}, ${j.at[1]})`);
};

let r = await ask();
check("no data: typical yard range $40-$80, no count", r.scope === "typical" && r.low_dollars === 40 && r.high_dollars === 80 && r.sample_count === null, r);

// Noise that must never count.
await job(1000, { is_seed: true });
await job(1000, { customer_id: TEST });
await job(1000, { helper_id: SEEDP });
await job(1000, { is_group_job: true });
await job(1000, { status: "cancelled" });
await job(1000, { payment_status: "unpaid" });
await job(1000, { payment_status: "abandoned" });
await job(1000, { age: "200 days" });
await job(1000, { category: "cleaning", customer_id: U(80) }); // real, but in another category (and one of the two cleaning posters below)

for (const b of [50, 60, 70, 80]) await job(b);
r = await ask();
check("4 real near jobs: still typical (needs 5)", r.scope === "typical" && r.sample_count === null, r);
await job(90);
r = await ask();
// 50,60,70,80,90: p25 = 60, p75 = 80; the noise never counted.
check("5 real near jobs from 3 posters: near $60-$80", r.scope === "near" && r.sample_count === 5 && r.low_dollars === 60 && r.high_dollars === 80, r);
r = await ask(ME, "yard_work", FAR);
check("from 120 miles away: the same jobs are statewide", r.scope === "state" && r.sample_count === 5, r);
r = await ask(ME, "yard_work", null);
check("no location: statewide", r.scope === "state", r);
r = await ask(null);
check("guest (anon): typical only, even with real data", r.scope === "typical" && r.sample_count === null && r.low_dollars === 40, r);

// Five cleaning jobs from TWO posters: thin.
for (let i = 0; i < 5; i++) await job(100 + i * 10, { category: "cleaning", customer_id: U(80 + (i % 2)) });
r = await ask(ME, "cleaning");
check("5 jobs from 2 posters: typical (needs 3 posters)", r.scope === "typical" && r.low_dollars === 80 && r.high_dollars === 150, r);

r = await ask(ME, "not_a_category");
check("unknown category: no row", r === undefined, r);

const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'get_fair_price_hint'`)).rows[0].a;
check("EXECUTE for anon and authenticated, not PUBLIC", /anon=X/.test(acl) && /authenticated=X/.test(acl) && !/(^|\{|,)=X/.test(acl), acl);
const tacl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'fair_price_typical'`)).rows[0].a;
check("fair_price_typical: no anon, authenticated or PUBLIC", !/anon=/.test(tacl) && !/authenticated=/.test(tacl) && !/(^|\{|,)=X/.test(tacl), tacl);
const old = (await db.query(`SELECT count(*)::int AS c FROM pg_proc WHERE proname = 'get_price_guidance'`)).rows[0].c;
const sw = (await db.query(`SELECT count(*)::int AS c FROM public.feature_switches WHERE key = 'price_guidance'`)).rows[0].c;
check("get_price_guidance and the price_guidance switch are retired", old === 0 && sw === 0, { old, sw });
console.log(`${n - fails}/${n} pass (3x applied)`);
process.exit(fails ? 1 : 0);

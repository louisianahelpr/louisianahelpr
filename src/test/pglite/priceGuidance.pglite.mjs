#!/usr/bin/env node
/**
 * PGlite proof for 20261021054721_price_guidance.sql (board 190).
 *
 *   node src/test/pglite/priceGuidance.pglite.mjs
 *
 * The whole migration applied 3x (replay). auth.uid() and require_feature() are stubs. Checks: with 29 real
 * jobs the range is NULL (never a thin-sample number); the 30th real job opens the middle half (25th-75th
 * percentile, whole dollars); seed jobs, test-account and seed-profile posters or Helprs, crew jobs, other
 * categories, unfinished and older-than-90-days jobs never count; one poster alone never opens it; below the floor and signed out the count is NULL too; switch off refuses;
 * anon and PUBLIC have no EXECUTE.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const SQL = readFileSync(new URL("../../../supabase/migrations/20261021054721_price_guidance.sql", import.meta.url).pathname, "utf8");

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = U(1), TEST = U(2), SEEDP = U(3);
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text, description text);
  CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN IF coalesce(current_setting('test.feature', true), '') <> 'on' THEN RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501'; END IF; END $$;
  CREATE TYPE public.job_category AS ENUM ('pressure_washing', 'cleaning');
  CREATE TABLE public.jobs (id serial PRIMARY KEY, category public.job_category, budget numeric, status text, completed_at timestamptz,
    is_seed boolean, is_group_job boolean, customer_id uuid, helper_id uuid);
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean);
  INSERT INTO public.test_accounts VALUES ('${TEST}');
  INSERT INTO public.profiles VALUES ('${SEEDP}', true);
`);
for (let i = 0; i < 3; i++) await db.exec(SQL);

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const ask = async (uid = ME, feature = "on", cat = "pressure_washing") => {
  await db.exec(`SET test.uid = '${uid ?? ""}'; SET test.feature = '${feature}'`);
  return (await db.query(`SELECT * FROM public.get_price_guidance('${cat}')`)).rows[0];
};
let seq = 0;
const job = (budget, extra = {}) => {
  // Three real posters take turns, unless a case names one.
  const j = { category: "pressure_washing", status: "completed", age: "1 day", is_seed: false, is_group_job: false, customer_id: U(60 + (seq++ % 3)), helper_id: U(51), ...extra };
  return db.exec(`INSERT INTO public.jobs (category, budget, status, completed_at, is_seed, is_group_job, customer_id, helper_id)
    VALUES ('${j.category}', ${budget}, '${j.status}', now() - interval '${j.age}', ${j.is_seed}, ${j.is_group_job}, '${j.customer_id}', '${j.helper_id}')`);
};

// Noise that must never count.
await job(1000, { is_seed: true });
await job(1000, { customer_id: TEST });
await job(1000, { helper_id: SEEDP });
await job(1000, { is_group_job: true });
await job(1000, { category: "cleaning" });
await job(1000, { status: "open" });
await job(1000, { age: "120 days" });
// 29 real jobs (one under the 2026-10-21 threshold): $60..$200 in $5 steps.
for (let i = 0; i < 29; i++) await job(60 + i * 5);
let r = await ask();
check("29 real jobs: count and range hidden (NULL)", r.sample_count === null && r.low_dollars === null && r.high_dollars === null, r);
await job(205);
r = await ask();
// 30 values 60..205 step 5: p25 = 96.25 -> 96, p75 = 168.75 -> 169.
check("30 real jobs: the middle half in whole dollars ($96-$169); the noise never counted", r.sample_count === 30 && r.low_dollars === 96 && r.high_dollars === 169, r);
r = await ask(null);
check("signed out: no count and no range", r.sample_count === null && r.low_dollars === null, r);
// 30+ jobs (the 2026-10-21 threshold) but all from ONE poster in another category: hidden (one heavy poster never sets the range).
for (let i = 0; i < 31; i++) await job(50 + i, { category: "cleaning", customer_id: U(70) });
r = await ask(ME, "on", "cleaning");
check("31 jobs from one poster: hidden (needs 3 posters)", r.sample_count === null && r.low_dollars === null, r);
let refused = false;
try { await ask(ME, "off"); } catch (e) { refused = /feature_disabled/.test(String(e.message)); }
check("switch off: refused", refused);
const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'get_price_guidance'`)).rows[0].a;
check("EXECUTE for authenticated (no anon, no PUBLIC)", /authenticated=X/.test(acl) && !/anon=/.test(acl) && !/(^|\{|,)=X/.test(acl), acl);
console.log(`${n - fails}/${n} pass (3x applied)`);
process.exit(fails ? 1 : 0);

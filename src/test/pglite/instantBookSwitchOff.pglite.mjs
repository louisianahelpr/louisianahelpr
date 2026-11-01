#!/usr/bin/env node
/**
 * PGlite proof for 20261101164117_instant_book_switch_off.sql (owner 11-01: instant book OFF for everyone).
 *
 *   node src/test/pglite/instantBookSwitchOff.pglite.mjs                     # GREEN, the migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/instantBookSwitchOff.pglite.mjs  # RED: the three RPCs as before it
 *
 * World: hiddenFeatureSwitches.pglite.mjs's SCHEMA (read from that file) + 20261012031120 (the switch registry,
 * feature_enabled_for, require_feature), plus minimal stubs the three RPC bodies reach (is_caller_banned, jobs,
 * profiles, notifications, instant_book_floors, instant_book_block_reason -> NULL, member_display_name, ...).
 * Proves, for an admin, a test account and an ordinary member alike:
 *   S1  the switch exists with audience 'off'; a replay keeps an admin's later change
 *   S2  rpc_instant_book, rpc_set_instant_book_floor and instant_book_candidates raise feature_disabled (42501)
 *   S3  nothing was written (no floor row, no booking on the job)
 *   S4  control: with the switch at 'everyone' the same calls run (a floor is set, a booking lands)
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SKIP = process.env.NEW_MIGRATION === "skip";
const proof = readFileSync(new URL("./hiddenFeatureSwitches.pglite.mjs", import.meta.url), "utf8");
const SCHEMA = proof.match(/const SCHEMA = `([\s\S]*?)`;/)[1];
const fnFrom = (file, fn) => readFileSync(DIR + file, "utf8").match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?\\$fn\\$;`))[0];

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(readFileSync(DIR + "20261012031120_hidden_feature_switches.sql", "utf8"));
await db.exec(`
CREATE TYPE public.job_category AS ENUM ('cleaning', 'moving');
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, avatar_url text);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, title text, budget numeric, date_needed date, category public.job_category,
  offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz, instant_booked_at timestamptz, instant_decline_until timestamptz);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text, job_id uuid);
CREATE TABLE public.instant_book_floors (helper_id uuid, category public.job_category, floor_cents int, updated_at timestamptz DEFAULT now(), PRIMARY KEY (helper_id, category));
CREATE TABLE public.reviews (reviewee_id uuid, reviewer_id uuid, rating int, status text);
CREATE FUNCTION public.instant_book_block_reason(p_job_id uuid, p_helper uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT CASE WHEN p_helper IS NULL THEN 'not_eligible' END $$;
CREATE FUNCTION public.instant_book_real_jobs_done(p_helper uuid) RETURNS int LANGUAGE sql STABLE AS $$ SELECT 0 $$;
CREATE FUNCTION public.is_test_member(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.member_display_name(n text, fallback text DEFAULT 'A neighbor') RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(n, fallback) $$;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
`);

if (SKIP) {
  await db.exec(fnFrom("20261101065105_instant_book_booking.sql", "rpc_instant_book"));
  await db.exec(fnFrom("20261101063725_instant_book_floors.sql", "rpc_set_instant_book_floor"));
  await db.exec(fnFrom("20261101063725_instant_book_floors.sql", "instant_book_candidates"));
} else {
  const sql = readFileSync(DIR + "20261101164117_instant_book_switch_off.sql", "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
}

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const TESTER = "00000000-0000-0000-0000-00000000000b";
const ORDINARY = "00000000-0000-0000-0000-00000000000c";
const HELPR = "00000000-0000-0000-0000-00000000000d";
await db.exec(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ORDINARY}', 'helper') ON CONFLICT DO NOTHING;
  INSERT INTO public.test_accounts (user_id) VALUES ('${TESTER}') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (user_id, full_name) VALUES ('${ADMIN}', 'Ad'), ('${TESTER}', 'Te'), ('${ORDINARY}', 'Or'), ('${HELPR}', 'He');`);
for (const [i, u] of [ADMIN, TESTER, ORDINARY].entries()) {
  await db.exec(`INSERT INTO public.jobs (id, customer_id, title, budget, date_needed, category) VALUES ('00000000-0000-0000-0000-00000000010${i}', '${u}', 'Mow', 60, current_date + 3, 'cleaning');`);
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };
async function as(uid, sql) {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { await db.query(sql); return "ok"; } catch (e) { return e.message; } finally { await db.exec("RESET ROLE;"); }
}

const sw = (await db.query(`SELECT audience FROM public.feature_switches WHERE key = 'instant_book'`)).rows[0];
ok(sw?.audience === "off", `S1 instant_book exists, audience 'off' (got ${sw?.audience})`);

for (const [i, [who, u]] of [["admin", ADMIN], ["tester", TESTER], ["ordinary", ORDINARY]].entries()) {
  const job = `00000000-0000-0000-0000-00000000010${i}`;
  ok((await as(u, `SELECT public.rpc_instant_book('${job}', '${HELPR}')`)) === "feature_disabled", `S2 ${who}: rpc_instant_book refused feature_disabled`);
  ok((await as(u, `SELECT * FROM public.instant_book_candidates('${job}')`)) === "feature_disabled", `S2 ${who}: instant_book_candidates refused`);
  ok((await as(u, `SELECT public.rpc_set_instant_book_floor('cleaning', 5000)`)) === "feature_disabled", `S2 ${who}: rpc_set_instant_book_floor refused`);
}
const floors = (await db.query(`SELECT count(*)::int n FROM public.instant_book_floors`)).rows[0].n;
const booked = (await db.query(`SELECT count(*)::int n FROM public.jobs WHERE instant_booked_at IS NOT NULL`)).rows[0].n;
ok(floors === 0 && booked === 0, `S3 nothing written (floors ${floors}, bookings ${booked})`);

if (!SKIP) {
  // A replay never overrides an admin's later choice (ON CONFLICT DO NOTHING).
  await db.exec(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'instant_book';`);
  await db.exec(readFileSync(DIR + "20261101164117_instant_book_switch_off.sql", "utf8"));
  ok((await db.query(`SELECT audience FROM public.feature_switches WHERE key = 'instant_book'`)).rows[0].audience === "testers", "S1 a replay keeps an admin's later change");
  // Control: on for everyone, the same calls run.
  await db.exec(`ALTER TABLE public.feature_switches DISABLE TRIGGER USER; UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'instant_book';`);
  ok((await as(ORDINARY, `SELECT public.rpc_set_instant_book_floor('cleaning', 5000)`)) === "ok", "S4 control: switch on, an ordinary member sets a floor");
  ok((await as(ORDINARY, `SELECT public.rpc_instant_book('00000000-0000-0000-0000-000000000102', '${HELPR}')`)) === "ok", "S4 control: switch on, the poster books");
}
console.log(`${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);

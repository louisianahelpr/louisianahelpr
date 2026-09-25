#!/usr/bin/env node
/**
 * PGlite proof for 20260925053956_auto_tip_anchor_on_opt_in (CJ-008).
 *
 *   node src/test/pglite/autoTipAnchoredOnOptIn.pglite.mjs
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). Loads the
 * ORIGINAL auto_tip_candidates() verbatim from 20260811200000 and prints
 * "OLD STATE RED" when it (a) drops a job completed 30h ago by a poster who
 * was already opted in, and (b) offers a job finished 90 days ago whose row
 * was touched today. Then applies the new migration 3x (replay-safe) and exits
 * 1 unless: (a) is a candidate, (b) is not, a job with an auto tip already is
 * not, the backfill keeps an existing opt-in's 24h reach, and the trigger
 * owns auto_tip_enabled_at (stamps on off->on, keeps on on->on, clears on
 * ->off, overwrites a direct client write).
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), "utf8");
const NEW = mig("20260925053956_auto_tip_anchor_on_opt_in.sql");
const ORIG = /CREATE OR REPLACE FUNCTION public\.auto_tip_candidates[\s\S]*?\$\$;/.exec(mig("20260811200000_auto_tip_charge.sql"))[0];

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create type public.auto_tip_mode as enum ('off','percent','fixed');
  create type public.job_status as enum ('open','in_progress','completed','cancelled');
  create table public.profiles(user_id uuid primary key, auto_tip_mode public.auto_tip_mode not null default 'off');
  create table public.jobs(id uuid primary key, customer_id uuid, helper_id uuid, budget numeric, status public.job_status,
                           completed_at timestamptz, updated_at timestamptz default now());
  create table public.tips(job_id uuid, source text);
  create function public.resolve_auto_tip(uuid, numeric) returns numeric language sql as 'select 5::numeric';
`);

const P_OLD = "00000000-0000-4000-8000-0000000000a1"; // opted in long before the migration
const P_NEW = "00000000-0000-4000-8000-0000000000a2"; // opts in after the migration
const H = "00000000-0000-4000-8000-0000000000b1";
const J = (n) => `00000000-0000-4000-8000-00000000000${n}`;
await db.exec(`
  insert into public.profiles values ('${P_OLD}', 'percent'), ('${P_NEW}', 'off');
  insert into public.jobs values
    ('${J(1)}', '${P_OLD}', '${H}', 100, 'completed', now() - interval '30 hours',  now() - interval '30 hours'),  -- missed by a >24h outage
    ('${J(2)}', '${P_OLD}', '${H}', 100, 'completed', now() - interval '90 days',   now()),                        -- old job, row touched today
    ('${J(3)}', '${P_OLD}', '${H}', 100, 'completed', now() - interval '20 hours',  now() - interval '20 hours'),  -- inside today's reach
    ('${J(4)}', '${P_OLD}', '${H}', 100, 'completed', now() - interval '2 hours',   now() - interval '2 hours'),   -- already auto-tipped
    ('${J(5)}', '${P_NEW}', '${H}', 100, 'completed', now() - interval '1 hour',    now() - interval '1 hour');    -- before P_NEW opts in
  insert into public.tips values ('${J(4)}', 'auto');
`);
const cands = async (arg = "") => (await db.query(`select job_id from public.auto_tip_candidates(${arg}) order by job_id`)).rows.map((r) => r.job_id);

await db.exec(ORIG);
const before = await cands();
if (!before.includes(J(1)) && before.includes(J(2))) {
  console.log("OLD STATE RED: 30h-old tip lost =", !before.includes(J(1)), "; 90-day-old job offered =", before.includes(J(2)), JSON.stringify(before));
} else {
  console.error("unexpected old state", before);
  process.exit(1);
}

const fails = [];
for (let i = 0; i < 3; i++) await db.exec(NEW);

// Backfill: P_OLD's reach at migration time is the last 24h.
const bf = (await db.query(`select (now() - auto_tip_enabled_at) between interval '23 hours 59 minutes' and interval '24 hours 1 minute' ok from public.profiles where user_id = '${P_OLD}'`)).rows[0];
if (!bf?.ok) fails.push("backfill did not set now() - 24h for an existing opt-in");

// P_OLD was backfilled to now()-24h, so J1 (30h) predates the opt-in. Move the
// opt-in back 40 days to model a poster who opted in long ago.
await db.exec(`alter table public.profiles disable trigger profiles_stamp_auto_tip_enabled_at;
               update public.profiles set auto_tip_enabled_at = now() - interval '40 days' where user_id = '${P_OLD}';
               alter table public.profiles enable trigger profiles_stamp_auto_tip_enabled_at;`);
let after = await cands();
if (!after.includes(J(1))) fails.push("a tip missed by a 30h outage is still lost");
if (after.includes(J(2))) fails.push("a job finished before the opt-in (90 days) is still offered");
if (!after.includes(J(3))) fails.push("a job completed 20h ago is not offered");
if (after.includes(J(4))) fails.push("an already auto-tipped job is offered again");

// Trigger owns the column.
await db.exec(`update public.profiles set auto_tip_mode = 'percent' where user_id = '${P_NEW}'`);
const stamped = (await db.query(`select auto_tip_enabled_at > now() - interval '1 minute' ok from public.profiles where user_id = '${P_NEW}'`)).rows[0];
if (!stamped?.ok) fails.push("off -> percent did not stamp auto_tip_enabled_at");
after = await cands();
if (after.includes(J(5))) fails.push("a job completed before the poster opted in is offered");
await db.exec(`update public.profiles set auto_tip_enabled_at = now() - interval '5 years' where user_id = '${P_NEW}'`);
const forged = (await db.query(`select auto_tip_enabled_at > now() - interval '1 minute' ok from public.profiles where user_id = '${P_NEW}'`)).rows[0];
if (!forged?.ok) fails.push("a direct write to auto_tip_enabled_at was kept");
await db.exec(`update public.profiles set auto_tip_mode = 'fixed' where user_id = '${P_NEW}'`);
const kept = (await db.query(`select auto_tip_enabled_at > now() - interval '1 minute' ok from public.profiles where user_id = '${P_NEW}'`)).rows[0];
if (!kept?.ok) fails.push("percent -> fixed lost the opt-in time");
await db.exec(`update public.profiles set auto_tip_mode = 'off' where user_id = '${P_NEW}'`);
const cleared = (await db.query(`select auto_tip_enabled_at is null ok from public.profiles where user_id = '${P_NEW}'`)).rows[0];
if (!cleared?.ok) fails.push("-> off did not clear auto_tip_enabled_at");

// The window still bounds: 336h default, and an explicit argument narrows it.
const narrow = await cands("1");
if (narrow.length !== 0) fails.push(`_since_hours => 1 still returned ${JSON.stringify(narrow)}`);

if (fails.length) {
  console.error("FAIL\n" + fails.join("\n"));
  process.exit(1);
}
console.log("GREEN after 3x apply:", JSON.stringify(after));

#!/usr/bin/env node
/**
 * PGlite proof for 20261031202929_helpr_my_tasks_ended_at (AUD31-27, the date part): helpr_my_tasks() returns, for each
 * finished task (confirmed, unfilled, cancelled, failed), the time it ended (confirmed_at, else closed_at, else
 * updated_at), and NULL while a task is under way. Everything the newest body returned is unchanged: the caller's own
 * tasks only, the same rows in the same order, the same take-home; anon still cannot call it.
 *
 *   node src/test/pglite/helprMyTasksEndedAt.pglite.mjs                  # base, then this migration 3x
 *   NEW_MIGRATION=skip node src/test/pglite/helprMyTasksEndedAt.pglite.mjs # RED: the body before it
 *   MUTANT=<name> node src/test/pglite/helprMyTasksEndedAt.pglite.mjs    # a planted defect: must FAIL
 *
 * Base: the newest CREATE of helpr_my_tasks before this migration (20261021181118, read from the migrations folder).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = "20261031202929_helpr_my_tasks_ended_at.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // Every finished task dated by its last touch, never by when it was confirmed or closed.
  updatedonly: ["ELSE COALESCE(t.confirmed_at, t.closed_at, t.updated_at) END", "ELSE t.updated_at END"],
  // A task under way gets a date too.
  activedated: ["CASE WHEN t.status IN ('open', 'accepted', 'picked_up', 'delivered') THEN NULL", "CASE WHEN false THEN NULL"],
  // The grants are not restated: a fresh CREATE is open to PUBLIC.
  nogrants: ["REVOKE ALL ON FUNCTION public.helpr_my_tasks() FROM PUBLIC, anon;", ""],
};
const skip = process.env.NEW_MIGRATION === "skip";
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replaceAll(m[0], m[1]);
}

/** The newest CREATE FUNCTION text for `name` in migrations strictly before `before` (raw text, no rewrites). */
function newestBefore(name, before) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
    let m;
    while ((m = re.exec(sql))) {
      const as = /\bAS\s+(\$\w*\$)/g;
      as.lastIndex = m.index;
      const t = as.exec(sql);
      const end = sql.indexOf(t[1], t.index + t[0].length);
      found = { file: f, sql: `${sql.slice(m.index, end + t[1].length)};` };
    }
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found;
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const T = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const HELPR = U(1), OTHER = U(2);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create function public.helpr_payout_round_down_cents(p_cents integer) returns integer language sql immutable as $f$ select (p_cents / 100) * 100 $f$;
  create table public.helpr_tasks (id uuid primary key, status text not null, size text not null default 'small', title text not null,
    pickup_area text default 'Mid City', dropoff_area text default 'Uptown', trip_miles integer default 4, pay_cents integer not null default 2500,
    fee_cents integer not null default 195, helpr_id uuid, pickup_slot_start timestamptz, confirmed_at timestamptz, closed_at timestamptz,
    updated_at timestamptz not null default now());
  create table public.helpr_task_payouts (task_id uuid primary key, status text);
`);
const base = newestBefore("helpr_my_tasks", THIS);
check(base.file === "20261021181118_helpr_delivery_payout_round_down.sql", `[world] the base is the newest CREATE before this migration (${base.file})`);
await db.exec(base.sql);
await db.exec(`REVOKE ALL ON FUNCTION public.helpr_my_tasks() FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.helpr_my_tasks() TO authenticated, service_role;`);

// The caller's tasks: one under way, one confirmed, one closed unfilled, one damaged (failed); and another Helpr's.
await db.exec(`
  insert into public.helpr_tasks (id, status, title, helpr_id, pickup_slot_start, confirmed_at, closed_at, updated_at) values
    ('${T(1)}', 'accepted',  'Oak chair',   '${HELPR}', now() + interval '1 day',  null, null, now() - interval '1 hour'),
    ('${T(2)}', 'confirmed', 'Lamp',        '${HELPR}', now() - interval '5 days', now() - interval '4 days', null, now() - interval '2 days'),
    ('${T(3)}', 'unfilled',  'Desk',        '${HELPR}', now() - interval '6 days', null, now() - interval '6 days', now() - interval '1 day'),
    ('${T(4)}', 'failed',    'Mirror',      '${HELPR}', now() - interval '8 days', null, now() - interval '7 days', now() - interval '3 days'),
    ('${T(5)}', 'cancelled', 'Rug',         '${HELPR}', now() - interval '9 days', null, null, now() - interval '9 days'),
    ('${T(9)}', 'confirmed', 'Not mine',    '${OTHER}', now() - interval '2 days', now() - interval '2 days', null, now() - interval '2 days');
  insert into public.helpr_task_payouts values ('${T(2)}', 'succeeded');
`);

async function asHelpr(sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${HELPR}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const before = await asHelpr("select task_id, status, size, title, pickup_area, dropoff_area, trip_miles, take_home_cents, pickup_slot_start, payout_status from public.helpr_my_tasks()");

if (skip) {
  console.log("NEW_MIGRATION=skip: the checks run on the body before it (expect FAILs)");
} else {
  for (let run = 1; run <= 3; run++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${run} of 3)`); } catch (e) { check(false, `the migration applies (run ${run} of 3): ${e.message}`); }
  }
}

let rows = [];
try {
  rows = await asHelpr("select task_id, status, size, title, pickup_area, dropoff_area, trip_miles, take_home_cents, pickup_slot_start, payout_status, ended_at from public.helpr_my_tasks()");
  check(true, "helpr_my_tasks() returns ended_at");
} catch (e) {
  check(false, `helpr_my_tasks() returns ended_at: ${e.message}`);
}
const truth = (await db.query(`select id, confirmed_at, closed_at, updated_at from public.helpr_tasks`)).rows;
const at = (id) => truth.find((r) => r.id === id);
const ended = (id) => rows.find((r) => r.task_id === id)?.ended_at ?? null;
const same = (a, b) => (a && b ? new Date(a).getTime() === new Date(b).getTime() : a === b);

check(rows.length > 0 && ended(T(1)) === null, "a task under way has no end date");
check(rows.length > 0 && same(ended(T(2)), at(T(2)).confirmed_at), "a confirmed delivery ends when it was confirmed");
check(rows.length > 0 && same(ended(T(3)), at(T(3)).closed_at), "an unfilled task ends when it was closed");
check(rows.length > 0 && same(ended(T(4)), at(T(4)).closed_at), "a damaged (failed) delivery ends when it was closed");
check(rows.length > 0 && same(ended(T(5)), at(T(5)).updated_at), "a task with neither stamp ends at its last change");
check(rows.length > 0 && !rows.some((r) => r.task_id === T(9)), "another Helpr's task is never returned");
const strip = (r) => { const { ended_at: _e, ...rest } = r; return JSON.stringify(rest); };
check(rows.length > 0 && JSON.stringify(rows.map(strip)) === JSON.stringify(before.map((r) => JSON.stringify(r))), "every other column, row and the order are as before");

const acl = (await db.query(`select has_function_privilege('anon', 'public.helpr_my_tasks()', 'execute') as anon,
  has_function_privilege('authenticated', 'public.helpr_my_tasks()', 'execute') as authd`)).rows[0];
check(acl.anon === false, "anon cannot call it");
check(acl.authd === true, "a signed-in member can call it");

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);

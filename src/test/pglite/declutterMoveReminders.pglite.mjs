#!/usr/bin/env node
/**
 * PGlite proof for the moving-sale reminders (owner 2026-10-30: reminders only, nothing closes).
 *
 *   node src/test/pglite/declutterMoveReminders.pglite.mjs                     # ALL PASS (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterMoveReminders.pglite.mjs  # RED: no sweep
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterMoveReminders.pglite.mjs
 *
 * A stub world: the tables carry only the columns the sweep reads (prod's names and types, 2026-10-30);
 * feature_enabled_for_user, declutter_member_out, declutter_notify and log_cron_defect are stubs that record what they
 * were asked. cron, cron_work_expectations and cron_catchup_policy are absent, so the migration's guarded blocks skip.
 * The clock is not moved: dates are written relative to today.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const file = process.env.MIGRATION_PATH ?? `${MIG_DIR}${readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_move_reminders.sql"))}`;
const mig = process.env.NEW_MIGRATION === "skip" ? "" : readFileSync(file, "utf8");

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`PASS ${what}`); } else { fail++; console.log(`FAIL ${what}`); } };

const db = new PGlite();
const u = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const TOMORROW = u(1), AFTER = u(2), LATE = u(3), TEST = u(4), SEEDP = u(5), OPTOUT = u(6), OUT = u(7), OFF = u(8), FAR = u(9);
const TODAY = "a".repeat(8) + "-aaaa-4aaa-8aaa-" + "a".repeat(12), SOLD = "b".repeat(8) + "-bbbb-4bbb-8bbb-" + "b".repeat(12);
const NOTLIVE = "c".repeat(8) + "-cccc-4ccc-8ccc-" + "c".repeat(12), SEEDI = "d".repeat(8) + "-dddd-4ddd-8ddd-" + "d".repeat(12);
const TOO = "e".repeat(8) + "-eeee-4eee-8eee-" + "e".repeat(12), PLAIN = "f".repeat(8) + "-ffff-4fff-8fff-" + "f".repeat(12);
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key);
create table public.profiles(user_id uuid primary key, is_seed boolean not null default false);
create table public.test_accounts(user_id uuid primary key);
create table public.notification_preferences(user_id uuid primary key, declutter_listings boolean not null default true);
create table public.declutter_items(id uuid primary key default gen_random_uuid(), seller_id uuid, title text, status text, in_moving_sale boolean not null default false, is_seed boolean not null default false);
create table public.declutter_item_private(item_id uuid primary key, seller_id uuid, move_out_on date);
create function public.feature_enabled_for_user(k text, x uuid) returns boolean language sql as $$ select x <> '${OFF}'::uuid or k <> 'declutter_moving_out' $$;
create function public.declutter_member_out(x uuid) returns boolean language sql as $$ select x = '${OUT}'::uuid $$;
create table notes(user_id uuid, type text, title text, message text, link text, other uuid);
create function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid default null)
  returns void language sql as $$ insert into notes values (p_user, p_type, p_title, p_message, p_link, p_other) $$;
create table defects(src text, k text, msg text);
create function public.log_cron_defect(a text, b text, c text) returns void language sql as $$ insert into defects values (a, b, c) $$;
`);
const today = `(now() at time zone 'America/Chicago')::date`;
const sellers = [TOMORROW, AFTER, LATE, TEST, SEEDP, OPTOUT, OUT, OFF, FAR, TODAY, SOLD, NOTLIVE, SEEDI, TOO, PLAIN];
for (const s of sellers) await db.exec(`insert into auth.users values ('${s}'); insert into profiles values ('${s}', ${s === SEEDP});`);
await db.exec(`insert into test_accounts values ('${TEST}'); insert into notification_preferences values ('${OPTOUT}', false), ('${AFTER}', true);`);
const add = async (seller, offset, status = "live", opts = {}) => {
  const { rows } = await db.query(`insert into declutter_items (seller_id, title, status, in_moving_sale, is_seed) values ('${seller}', 'Thing', '${status}', ${opts.inSale ?? true}, ${opts.seed ?? false}) returning id`);
  await db.exec(`insert into declutter_item_private values ('${rows[0].id}', '${seller}', ${offset === null ? "null" : `${today} + ${offset}`})`);
  return rows[0].id;
};
const tomorrowItem = await add(TOMORROW, 1);
await add(AFTER, -1); await add(AFTER, -1); await add(AFTER, -1, "sold");
const lateItem = await add(LATE, -3);
await add(TEST, 1); await add(SEEDP, 1); await add(OPTOUT, 1); await add(OUT, 1); await add(OFF, 1);
await add(FAR, 5); await add(TODAY, 0);
await add(SOLD, 1, "sold");                     // nothing open
await add(NOTLIVE, -1, "paused");               // the day after: nothing LIVE
await add(SEEDI, 1, "live", { seed: true });
await add(TOO, -4);                             // too long ago
await add(PLAIN, 1, "live", { inSale: false }); // not in a sale

for (let i = 0; i < 3 && mig; i++) await db.exec(mig);

const hasMark = (await db.query(`select to_regclass('public.declutter_move_reminders')::text t`)).rows[0].t;
ok(!!hasMark, "the told mark table exists");
if (!hasMark) { console.log(`\n${pass} PASS / ${fail + 1} FAIL (no sweep: nothing else to check)`); process.exit(1); }

const statusBefore = (await db.query(`select id, status, in_moving_sale from declutter_items order by id`)).rows;
const run = async () => { try { return (await db.query(`select public.declutter_move_reminder_sweep() r`)).rows[0].r; } catch (e) { return { err: e.message }; } };
const r1 = await run();
const told = (await db.query(`select * from notes`)).rows;
const to = (s) => told.filter((n) => n.user_id === s);
ok(r1?.told === 3 && r1?.errors === 0, `first run tells 3 sellers, no errors (${JSON.stringify(r1)})`);
ok(to(TOMORROW).length === 1 && to(TOMORROW)[0].title === "Your move is tomorrow" && to(TOMORROW)[0].message === "Take down what's left, or change the date.", `the day before: the owner's words (${JSON.stringify(to(TOMORROW)[0])})`);
ok(to(AFTER).length === 1 && to(AFTER)[0].message === "2 listings are still up. Take down what's left, or change the date.", `the day after: counts the live ones only (${to(AFTER)[0]?.message})`);
ok(to(LATE).length === 1 && to(LATE)[0].message.startsWith("1 listing is still up."), "a run missed: up to 3 days back still tells, one listing in the singular");
ok(told.every((n) => n.link === "/declutter?tab=selling" && n.type === "declutter_listings"), "every notice links to Selling, in the Listings group");
for (const [s, why] of [[TEST, "test account"], [SEEDP, "seed profile"], [SEEDI, "seed listing"], [OPTOUT, "Listings notices switched off"], [OUT, "member out"], [OFF, "moving sale switch off"],
  [FAR, "date 5 days away"], [TODAY, "today"], [SOLD, "nothing open"], [NOTLIVE, "the day after, nothing live"], [TOO, "4 days past"], [PLAIN, "not in a moving sale"]]) {
  ok(to(s).length === 0, `never told: ${why}`);
}
const statusAfter = (await db.query(`select id, status, in_moving_sale from declutter_items order by id`)).rows;
ok(JSON.stringify(statusBefore) === JSON.stringify(statusAfter), "nothing closes: no listing's status or sale changed");

const r2 = await run();
ok(r2?.told === 0 && (await db.query(`select count(*)::int c from notes`)).rows[0].c === 3, "a second run tells nobody");

// A changed date is a new date: its reminder goes too.
await db.exec(`update declutter_item_private set move_out_on = ${today} + 1 where item_id = '${lateItem}'`);
const r3 = await run();
ok(r3?.told === 1 && (await db.query(`select count(*)::int c from notes where user_id = '${LATE}' and title = 'Your move is tomorrow'`)).rows[0].c === 1, "a moved date gets its own day-before notice");
// The day-before seller, a day on: the same sale gets its day-after notice, once.
await db.exec(`update declutter_item_private set move_out_on = ${today} - 1 where item_id = '${tomorrowItem}'`);
const r4 = await run();
ok(r4?.told === 1 && (await db.query(`select count(*)::int c from notes where user_id = '${TOMORROW}'`)).rows[0].c === 2, "the same seller gets the day-after notice too");
// The sale's date is its newest: an older item doesn't trigger a reminder.
const mix = u(0);
await db.exec(`insert into auth.users values ('${mix}'); insert into profiles values ('${mix}', false);`);
await add(mix, -1); await add(mix, 20);
ok((await run())?.told === 0, "the sale's date is its newest item's, as the banner reads it");

// A failed notice is logged, the rest go on (declutter_notify is the wrapper, so this is the sweep's own net).
await db.exec(`create or replace function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid default null)
  returns void language plpgsql as $$ begin raise exception 'boom'; end $$;`);
const bad = u(0).replace(/^0/, "0").replace("00000000-0000", "00000000-0001");
await db.exec(`insert into auth.users values ('${bad}'); insert into profiles values ('${bad}', false);`);
await add(bad, 1);
const r5 = await run();
ok(r5?.errors === 1 && (await db.query(`select count(*)::int c from defects where src = 'declutter_move_reminder_sweep'`)).rows[0].c === 1, `a failure is counted and logged (${JSON.stringify(r5)})`);
ok((await db.query(`select count(*)::int c from declutter_move_reminders where seller_id = '${bad}'`)).rows[0].c === 0, "a failed notice leaves no told mark, so the next run tries again");

const acl = (await db.query(`select proacl::text a, prosecdef d, proconfig::text c from pg_proc where proname = 'declutter_move_reminder_sweep'`)).rows[0];
ok(!/(^|[{,])(anon|authenticated)=/.test(acl?.a ?? "") && !/(^|[{,])=X/.test(acl?.a ?? "") && /service_role=X/.test(acl?.a ?? ""), `service role only (${acl?.a})`);
ok(acl?.d === true && /search_path=public, pg_temp/.test(acl?.c ?? ""), "SECURITY DEFINER with search_path public, pg_temp");
const tacl = (await db.query(`select relacl::text a, relrowsecurity r from pg_class where relname = 'declutter_move_reminders'`)).rows[0];
ok(tacl?.r === true && !/(anon|authenticated)=/.test(tacl?.a ?? ""), `the mark table: RLS on, no client privilege (${tacl?.a})`);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

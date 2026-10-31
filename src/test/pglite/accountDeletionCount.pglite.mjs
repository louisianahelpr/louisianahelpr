#!/usr/bin/env node
/**
 * PGlite proof for 20261031205315_account_deletion_count_in_daily_summary (OPS-DEL, owner 10-29): a deleted member is
 * counted (count only, nothing about who), and the daily member summary says how many accounts were deleted.
 *
 *   node src/test/pglite/accountDeletionCount.pglite.mjs                     # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/accountDeletionCount.pglite.mjs  # RED: the newest bodies before it
 *
 * World: new_member_summary_message, send_new_member_daily_summary and retract_new_member_notice_for_test_account from
 * their NEWEST CREATE (before this migration when skipped; with it, this migration's own file applied 3x), on tables
 * with the columns they read, auth.users included. Stubbed, and said so: is_test_subject (an email at example.com is a
 * test subject, as the real one reads it). It decides only who is skipped, which is checked both ways below.
 * [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261031205315_account_deletion_count_in_daily_summary.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";

function newest(name, upTo, incl) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (incl ? FILES[i] > upTo : FILES[i] >= upTo) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const start = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return { file: FILES[i], sql: src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";" };
  }
  throw new Error(`${name}: no definition up to ${upTo}`);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const ADMIN = "11111111-1111-1111-1111-111111111111";
const ANA = "22222222-2222-2222-2222-222222222222"; // a real member who deletes her account
const BEN = "33333333-3333-3333-3333-333333333333"; // a real member who deletes his account
const SEED = "44444444-4444-4444-4444-444444444444"; // a test account (is_seed)
const TEST = "55555555-5555-5555-5555-555555555555"; // a test subject by email
const NEVER = "66666666-6666-6666-6666-666666666666"; // a signup that never confirmed
const JOIN = "77777777-7777-7777-7777-777777777777"; // joined, later marked a test account

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
  grant usage on schema auth, public to anon, authenticated, service_role;
  create table public.profiles (user_id uuid primary key references auth.users(id) on delete cascade, full_name text,
    location text, is_seed boolean default false, anonymized_at timestamptz);
  create table public.user_roles (user_id uuid, role text);
  create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text,
    type text, link text, created_at timestamptz not null default now());
  create table public.new_member_admin_notices (user_id uuid primary key, via text, notified_at timestamptz not null default now(),
    summarized_at timestamptz);
  create function public.is_test_subject(p uuid) returns boolean language sql stable as
    $f$ select exists (select 1 from auth.users u where u.id = p and u.email like '%@example.com') $f$;
  insert into auth.users values
    ('${ADMIN}', 'owner@helpr.la', now()), ('${ANA}', 'ana@mail.la', now()), ('${BEN}', 'ben@mail.la', now()),
    ('${SEED}', 'seed@mail.la', now()), ('${TEST}', 'audit@example.com', now()), ('${NEVER}', 'never@mail.la', null),
    ('${JOIN}', 'jo@mail.la', now());
  insert into public.profiles (user_id, full_name, location, is_seed) values
    ('${ADMIN}', 'Owner', null, false), ('${ANA}', 'Ana', 'Lafayette', false), ('${BEN}', 'Ben', null, false),
    ('${SEED}', 'SEED Journey', null, true), ('${TEST}', 'Audit', null, false), ('${NEVER}', null, null, false),
    ('${JOIN}', 'Jo', 'Houma', false);
  insert into public.user_roles values ('${ADMIN}', 'admin');
`);

const NAMES = ["new_member_summary_message", "send_new_member_daily_summary", "retract_new_member_notice_for_test_account"];
for (const n of NAMES) {
  const d = newest(n, THIS, false);
  console.log(`      loaded ${n} from ${d.file}`);
  await db.exec(d.sql);
}
await db.exec(`create trigger retract_new_member_notice_for_test_account after update of is_seed on public.profiles
  for each row execute function public.retract_new_member_notice_for_test_account();`);
if (!SKIP) {
  const mig = readFileSync(MIG_DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times
  for (const n of NAMES.slice(1)) check(newest(n, THIS, true).file === THIS, `[keep] ${n}'s newest CREATE is this migration`);
}

const q = async (sql) => (await db.query(sql)).rows;
const tryQ = async (sql) => { try { return await q(sql); } catch (e) { return { error: e.message }; } };
const logged = async () => { const r = await tryQ(`select count(*)::int as n from public.account_deletion_log where summarized_at is null`); return r.error ? -1 : r[0].n; };
const summaries = async () => q(`select message, created_at from public.notifications where title = 'New member summary' order by created_at`);
const send = async () => (await q(`select public.send_new_member_daily_summary() as r`))[0].r;

// A day with nothing: nothing is sent.
check((await send()).sent === 0, "[keep] no joins and no deletions: nothing is sent");

// Deletions: two real members, a test account, a test subject by email, a never-confirmed signup.
for (const id of [ANA, BEN, SEED, TEST, NEVER]) await db.exec(`delete from auth.users where id = '${id}'`);
check((await q(`select count(*)::int as n from auth.users`))[0].n === 2, "[keep] every delete went through (the count never stops one)");
check((await logged()) === 2, `[fix] two real members deleted are counted; test accounts and an unconfirmed signup are not (got ${await logged()})`);
const cols = await tryQ(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'account_deletion_log' order by 1`);
check(!cols.error && cols.map((c) => c.column_name).join(",") === "deleted_at,id,summarized_at", "[fix] the log holds a count only: no user id, name or email");

// A day with deletions and no joins: one notice that says so.
let r = await send();
let s = await summaries();
check(r.sent === 1 && s.length === 1, `[fix] deletions alone still send the daily notice (sent ${r.sent})`);
check(s[0]?.message === "No new members joined. 2 accounts were deleted.", `[fix] it reads "No new members joined. 2 accounts were deleted." (got ${JSON.stringify(s[0]?.message)})`);
check((await logged()) === 0, "[fix] counted deletions are not counted again");
check((await send()).sent === 0, "[keep] the next run with nothing new sends nothing");

// A day with a join and a deletion.
await db.exec(`insert into public.new_member_admin_notices (user_id, via) values ('${JOIN}', 'confirm')`);
await db.exec(`insert into auth.users values ('${ANA}', 'ana2@mail.la', now()); delete from auth.users where id = '${ANA}'`);
r = await send();
s = await summaries();
const last = s[s.length - 1];
check(r.sent === 1 && last?.message?.startsWith("1 new member joined: Jo from Houma."), `[keep] the join is still named (got ${JSON.stringify(last?.message)})`);
check(last?.message === "1 new member joined: Jo from Houma. 1 account was deleted.", "[fix] and the deletion is said after it");

// The member it named is marked a test account: the summary keeps the deletion sentence.
await db.exec(`update public.profiles set is_seed = true where user_id = '${JOIN}'`);
s = await summaries();
check(s.length === 2, "[fix] the summary stays, since it still counts a deletion");
check(s[1]?.message === "No new members joined. 1 account was deleted.", `[fix] rebuilt without the test account, deletion kept (got ${JSON.stringify(s[1]?.message)})`);

// The count can fail (here: every insert into the log raises). The delete still goes through, uncounted.
const BREAK = "88888888-8888-8888-8888-888888888888";
const hasLog = !(await tryQ(`select 1 from public.account_deletion_log limit 1`)).error;
if (hasLog) await db.exec(`create function public.b29_refuse_log() returns trigger language plpgsql as $f$ begin raise exception 'log is broken'; end $f$;
  create trigger b29_refuse_log before insert on public.account_deletion_log for each row execute function public.b29_refuse_log();`);
await db.exec(`insert into auth.users values ('${BREAK}', 'cal@mail.la', now()); insert into public.profiles (user_id, full_name) values ('${BREAK}', 'Cal')`);
const del = await tryQ(`delete from auth.users where id = '${BREAK}' returning id`);
check(!del.error && del.length === 1, `[keep] a failing count never blocks the delete (${del.error ?? "deleted"})`);
check((await q(`select count(*)::int as n from auth.users where id = '${BREAK}'`))[0].n === 0, "[keep] the account is gone");
if (hasLog) await db.exec(`drop trigger b29_refuse_log on public.account_deletion_log`);

const g = await tryQ(`select has_table_privilege('authenticated', 'public.account_deletion_log', 'select') as m,
  has_table_privilege('anon', 'public.account_deletion_log', 'select') as a`);
check(!g.error && !g[0].m && !g[0].a, "[fix] members and guests cannot read the log");

console.log(failures ? `\n${failures} FAILED${SKIP ? " (expected: NEW_MIGRATION=skip is the before state)" : ""}` : "\nALL PASS");
process.exit(failures ? 1 : 0);

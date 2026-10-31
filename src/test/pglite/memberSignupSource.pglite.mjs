#!/usr/bin/env node
/**
 * PGlite proof for 20261031220447_member_signup_source_report (OPS-5, owner 10-29): which links bring sign-ups and
 * first posts, with no personal data kept.
 *
 *   node src/test/pglite/memberSignupSource.pglite.mjs                     # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/memberSignupSource.pglite.mjs  # RED: before it (nothing exists)
 *
 * World: auth.users (with created_at), profiles, user_roles, jobs, declutter_items with the columns the report reads.
 * Stubbed, and said so: auth.uid() reads request.jwt.claim.sub (as PostgREST sets it); has_role reads user_roles;
 * is_test_subject = an email at example.com (as the real one reads a test login). They decide only who is signed in,
 * who is an admin and who is a test account, each checked both ways below.
 * [fix] checks FAIL on the before state; [keep] checks pass in both.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = "20261031220447_member_signup_source_report.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const ADMIN = "11111111-1111-1111-1111-111111111111";
const ANA = "22222222-2222-2222-2222-222222222222"; // new, came from facebook, campaign 'post-12', posts a job
const BEN = "33333333-3333-3333-3333-333333333333"; // new, came from facebook, no campaign, lists an item
const CAL = "44444444-4444-4444-4444-444444444444"; // new, direct, posts nothing
const OLD = "55555555-5555-5555-5555-555555555555"; // joined 30 days ago, opens a tagged link today
const SEED = "66666666-6666-6666-6666-666666666666"; // seed profile
const TEST = "77777777-7777-7777-7777-777777777777"; // test account by email

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  create type public.app_role as enum ('admin', 'user');
  create table public.profiles (user_id uuid primary key references auth.users(id) on delete cascade,
    is_seed boolean default false, anonymized_at timestamptz);
  create table public.user_roles (user_id uuid, role public.app_role);
  create function public.has_role(p_user uuid, p_role public.app_role) returns boolean language sql stable as
    $f$ select exists (select 1 from public.user_roles r where r.user_id = p_user and r.role = p_role) $f$;
  create function public.is_test_subject(p uuid) returns boolean language sql stable as
    $f$ select exists (select 1 from auth.users u where u.id = p and u.email like '%@example.com') $f$;
  create table public.jobs (id uuid primary key default gen_random_uuid(), customer_id uuid, is_seed boolean default false,
    created_at timestamptz not null default now());
  create table public.declutter_items (id uuid primary key default gen_random_uuid(), seller_id uuid,
    is_seed boolean default false, live_at timestamptz);
  insert into auth.users (id, email, created_at) values
    ('${ADMIN}', 'owner@helpr.la', now() - interval '400 days'), ('${ANA}', 'ana@mail.la', now()),
    ('${BEN}', 'ben@mail.la', now()), ('${CAL}', 'cal@mail.la', now()),
    ('${OLD}', 'old@mail.la', now() - interval '30 days'), ('${SEED}', 'seed@mail.la', now()),
    ('${TEST}', 'audit@example.com', now());
  insert into public.profiles (user_id, is_seed) values ('${ADMIN}', false), ('${ANA}', false), ('${BEN}', false),
    ('${CAL}', false), ('${OLD}', false), ('${SEED}', true), ('${TEST}', false);
  insert into public.user_roles values ('${ADMIN}', 'admin');
`);

if (!SKIP) {
  const mig = readFileSync(MIG_DIR + THIS, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times
  check(true, "[keep] applied three times without error");
}

const q = async (sql) => (await db.query(sql)).rows;
const tryQ = async (sql) => { try { return await q(sql); } catch (e) { return { error: e.message }; } };
const as = async (uid, sql) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
  return tryQ(sql);
};
const record = async (uid, source, campaign) => {
  const r = await as(uid, `select public.record_my_signup_source(${source === null ? "null" : `'${source}'`}, ${campaign === null ? "null" : `'${campaign}'`}) as ok`);
  return r.error ? { error: r.error } : r[0].ok;
};

check((await record(ANA, "Facebook", "Post-12")) === true, "[fix] a new member's source is recorded");
check((await record(ANA, "google", null)) === false, "[fix] first one wins: a second call writes nothing");
check((await record(BEN, "facebook", "")) === true, "[fix] an empty campaign is fine");
check((await record(CAL, "", null)) === true, "[fix] no source at all is recorded as direct");
check((await record(OLD, "facebook", "post-12")) === false, "[fix] a member who joined 30 days ago is never counted as a new sign-up");
check((await record(SEED, "facebook", "post-12")) === true, "[fix] a seed profile can record (the report leaves it out)");
check((await record(TEST, "facebook", "post-12")) === true, "[fix] a test account can record (the report leaves it out)");
const anon = await record(null, "facebook", null);
check(anon && anon.error && /not_signed_in/.test(anon.error), `[fix] signed out is refused (${JSON.stringify(anon)})`);
const hostile = await record("88888888-8888-8888-8888-888888888888", "x", null);
check(hostile === false, "[fix] an id with no account writes nothing");

const rows = await tryQ(`select user_id::text, source, campaign from public.member_signup_sources order by source, campaign nulls first`);
check(!rows.error && rows.find((r) => r.user_id === ANA)?.source === "facebook" && rows.find((r) => r.user_id === ANA)?.campaign === "post-12",
  "[fix] words are cleaned to lower case");
check(!rows.error && rows.find((r) => r.user_id === CAL)?.source === "direct" && rows.find((r) => r.user_id === BEN)?.campaign === null,
  "[fix] empty source -> direct, empty campaign -> null");
const odd = await record(ADMIN, "x", null); // the admin's account is old: nothing written
check(odd === false, "[fix] the admin's old account is not a sign-up");
// A hostile string never lands as written: only a-z 0-9 . _ - and 64 characters.
await db.exec(`insert into auth.users (id, email) values ('99999999-9999-9999-9999-999999999999', 'eve@mail.la')`);
await record("99999999-9999-9999-9999-999999999999", "<script>alert(1)</script>https://evil.example/?email=eve@mail.la" + "a".repeat(80), null);
const eve = await tryQ(`select source from public.member_signup_sources where user_id = '99999999-9999-9999-9999-999999999999'`);
check(!eve.error && eve[0]?.source === "other", `[fix] a source holding an email address is never kept (${JSON.stringify(eve[0]?.source)})`);
await db.exec(`insert into auth.users (id, email) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'fay@mail.la')`);
await record("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "<script>alert(1)</script>" + "a".repeat(80), "fay@mail.la");
const fay = await tryQ(`select source, campaign from public.member_signup_sources where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'`);
check(!fay.error && fay[0] && /^[a-z0-9._-]{1,64}$/.test(fay[0].source) && fay[0].campaign === null,
  `[fix] a hostile source is cleaned to 64 safe characters and an email campaign is dropped (${JSON.stringify(fay[0])})`);

await db.exec(`insert into auth.users (id, email) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'gus@mail.la')`);
await record("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "5045551234", "call-3375550000");
const gus = await tryQ(`select source, campaign from public.member_signup_sources where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'`);
check(!gus.error && gus[0]?.source === "other" && gus[0]?.campaign === null, `[fix] a phone number in a word is never kept (${JSON.stringify(gus[0])})`);
// Review 10-31: a phone number written with separators, and a link-encoded email (%40), are dropped too.
const formatted = [
  ["c1000000-0000-0000-0000-000000000001", "555-123-4567", "spring", "a dashed phone number"],
  ["c1000000-0000-0000-0000-000000000002", "(555) 123-4567", "spring", "a phone number in brackets"],
  ["c1000000-0000-0000-0000-000000000003", "+1 555 123 4567", "spring", "a phone number with spaces and +1"],
  ["c1000000-0000-0000-0000-000000000004", "jo%40x.com", "spring", "a link-encoded email (%40)"],
  ["c1000000-0000-0000-0000-000000000005", "fmtcamp", "555-123-4567", "a dashed phone number as the campaign"],
  ["c1000000-0000-0000-0000-000000000006", "fmtcamp", "(555) 123-4567", "a bracketed phone number as the campaign"],
  ["c1000000-0000-0000-0000-000000000007", "fmtcamp", "+1 555 123 4567", "a +1 phone number as the campaign"],
  ["c1000000-0000-0000-0000-000000000008", "fmtcamp", "jo%40x.com", "a link-encoded email as the campaign"],
];
for (const [id, src, camp, what] of formatted) {
  await db.exec(`insert into auth.users (id, email) values ('${id}', 'f${id.slice(-1)}@mail.la')`);
  await record(id, src, camp);
  const r = await tryQ(`select source, campaign from public.member_signup_sources where user_id = '${id}'`);
  const sourceIsPhoneOrEmail = src !== "fmtcamp";
  const ok = !r.error && r[0] && (sourceIsPhoneOrEmail ? r[0].source === "other" && r[0].campaign === "spring" : r[0].source === "fmtcamp" && r[0].campaign === null);
  check(ok, `[fix] ${what} is never kept (${JSON.stringify(r[0] ?? r.error)})`);
}
await db.exec(`insert into auth.users (id, email) values ('c1000000-0000-0000-0000-000000000009', 'f9@mail.la')`);
await record("c1000000-0000-0000-0000-000000000009", "fall-2026", "post-12-x");
const fall = await tryQ(`select source, campaign from public.member_signup_sources where user_id = 'c1000000-0000-0000-0000-000000000009'`);
check(!fall.error && fall[0]?.source === "fall-2026" && fall[0]?.campaign === "post-12-x",
  `[keep] a word with a few digits (a year, a post number) is still kept (${JSON.stringify(fall[0])})`);

const cols = await tryQ(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'member_signup_sources' order by 1`);
check(!cols.error && cols.map((c) => c.column_name).join(",") === "campaign,recorded_at,source,user_id",
  "[fix] the table holds no personal data: no email, name, IP or link");

// First posts: Ana posts a job, Ben lists an item, the seed and test accounts post too.
await db.exec(`insert into public.jobs (customer_id) values ('${ANA}'), ('${SEED}'), ('${TEST}');
  insert into public.declutter_items (seller_id, live_at) values ('${BEN}', now()), ('${CAL}', null);`);

const report = await as(ADMIN, `select source, campaign, signups::int, first_posts::int from public.admin_signup_source_report(30)`);
const line = (s, c) => (report.error ? undefined : report.find((r) => r.source === s && r.campaign === c));
check(!report.error, `[fix] the admin report runs (${report.error ?? "ok"})`);
check(line("facebook", "post-12")?.signups === 1 && line("facebook", "post-12")?.first_posts === 1,
  `[fix] facebook/post-12: 1 sign-up, 1 first post; seed and test accounts left out (got ${JSON.stringify(line("facebook", "post-12"))})`);
check(line("facebook", null)?.signups === 1 && line("facebook", null)?.first_posts === 1,
  `[fix] facebook with no campaign: 1 sign-up, 1 first post (a Declutter item counts) (got ${JSON.stringify(line("facebook", null))})`);
check(line("direct", null)?.signups === 1 && line("direct", null)?.first_posts === 0,
  `[fix] direct: 1 sign-up, no post (an item never live is not a post) (got ${JSON.stringify(line("direct", null))})`);
check(!report.error && Object.keys(report[0] ?? {}).join(",") === "source,campaign,signups,first_posts",
  "[fix] the report returns counts only");

// An ordinary member, and someone signed out, cannot read it.
const notAdmin = await as(ANA, `select * from public.admin_signup_source_report(30)`);
check(notAdmin.error && /admin only/.test(notAdmin.error), `[fix] an ordinary member is refused (${notAdmin.error ?? "allowed!"})`);
const out = await as(null, `select * from public.admin_signup_source_report(30)`);
check(out.error && /admin only/.test(out.error), `[fix] signed out is refused (${out.error ?? "allowed!"})`);

// A member's row goes when the account does.
await db.exec(`delete from auth.users where id = '${CAL}'`);
const gone = await tryQ(`select count(*)::int as n from public.member_signup_sources where user_id = '${CAL}'`);
check(!gone.error && gone[0].n === 0, "[fix] a deleted account takes its row with it");

const g = await tryQ(`select has_table_privilege('authenticated', 'public.member_signup_sources', 'select') as a,
    has_table_privilege('anon', 'public.member_signup_sources', 'select') as b,
    has_function_privilege('anon', 'public.record_my_signup_source(text, text)', 'execute') as c,
    has_function_privilege('anon', 'public.admin_signup_source_report(integer)', 'execute') as d,
    has_function_privilege('authenticated', 'public.record_my_signup_source(text, text)', 'execute') as e`);
check(!g.error && g[0].a === false && g[0].b === false && g[0].c === false && g[0].d === false && g[0].e === true,
  `[fix] members cannot read the table; anon can call neither function; members can record (${JSON.stringify(g[0] ?? g.error)})`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/**
 * PGlite proof for 20261101021934 (B48, owner decision 10-31, App Store 1.2): a member reports a public question or its
 * answer on a Declutter listing (never their own words), the report keeps a copy, an admin removes the question or only
 * the answer from the reports queue, and the queue's read flags test data.
 *
 *   node src/test/pglite/declutterQuestionReport.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterQuestionReport.pglite.mjs # red: the checks need it
 *   MIGRATION_PATH=<planted copy> node ...                                     # red on a planted defect
 *
 * Stub world, and said so: only the tables and helpers the two functions read (reports, declutter_questions,
 * declutter_items, declutter_cart_items, profiles, declutter_wanted and messages for the trigger's other branches,
 * user_roles, admin_audit_log); require_feature / is_caller_banned / seed_hidden_in_discovery are stubs. pglite from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261101021934_declutter_question_report.sql`, "utf8");
const db = new PGlite();
const SELLER = "11111111-1111-4111-8111-111111111111";
const ASKER = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";
const ADMIN = "44444444-4444-4444-8444-444444444444";
const BUYER = "55555555-5555-4555-8555-555555555555";
const SEEDITEM = "a0000000-0000-4000-8000-000000000009", TESTER = "66666666-6666-4666-8666-666666666666";
const QSEED = "b0000000-0000-4000-8000-000000000009", QTESTER = "b0000000-0000-4000-8000-00000000000a", QNOANS = "b0000000-0000-4000-8000-00000000000b";
const LIVE = "a0000000-0000-4000-8000-000000000001", DRAFT = "a0000000-0000-4000-8000-000000000002", SOLD = "a0000000-0000-4000-8000-000000000003";
const Q1 = "b0000000-0000-4000-8000-000000000001", QGONE = "b0000000-0000-4000-8000-000000000002", QDRAFT = "b0000000-0000-4000-8000-000000000003",
  QSOLD = "b0000000-0000-4000-8000-000000000004", Q5 = "b0000000-0000-4000-8000-000000000005";
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('t.role', true), '') $$;
create type app_role as enum ('admin', 'user');
create table user_roles(user_id uuid, role app_role); insert into user_roles values ('${ADMIN}', 'admin');
create function has_role(u uuid, r app_role) returns boolean language sql as $$ select exists(select 1 from user_roles x where x.user_id = u and x.role = r) $$;
create function is_server_context() returns boolean language sql stable as $$ select auth.uid() is null and coalesce(auth.role(), '') not in ('anon', 'authenticated') $$;
create function require_feature(k text) returns void language sql as $$ select $$;
create function is_caller_banned() returns boolean language sql as $$ select false $$;
create function seed_hidden_from_caller() returns boolean language sql as $$ select true $$;
create function seed_hidden_in_discovery() returns boolean language sql as $$ select true $$;
create table declutter_items(id uuid primary key, seller_id uuid, status text, title text, seller_hidden boolean not null default false, is_seed boolean not null default false);
insert into declutter_items(id, seller_id, status, title, is_seed) values ('${LIVE}', '${SELLER}', 'live', 'Oak dresser', false), ('${DRAFT}', '${SELLER}', 'draft', 'Lamp', false), ('${SOLD}', '${SELLER}', 'sold', 'Chair', false), ('${SEEDITEM}', '${SELLER}', 'live', 'Test item', true);
create table profiles(user_id uuid primary key, is_seed boolean); insert into profiles values ('${SELLER}', false), ('${ASKER}', false), ('${MEMBER}', false), ('${ADMIN}', false), ('${BUYER}', false), ('${TESTER}', true);
create table declutter_cart_items(id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, status text);
insert into declutter_cart_items(item_id, buyer_id, status) values ('${SOLD}', '${BUYER}', 'paid');
create table declutter_questions(id uuid primary key, item_id uuid, asker_id uuid, question text, answer text, answered_at timestamptz, removed_at timestamptz, created_at timestamptz default now());
insert into declutter_questions(id, item_id, asker_id, question, answer, removed_at) values
  ('${Q1}', '${LIVE}', '${ASKER}', 'Does it have scratches?', 'Only one, on the back.', null),
  ('${QGONE}', '${LIVE}', '${ASKER}', 'Removed one', null, now()),
  ('${QDRAFT}', '${DRAFT}', '${ASKER}', 'On a draft', null, null),
  ('${QSOLD}', '${SOLD}', '${ASKER}', 'On a sold one', 'Yes', null),
  ('${Q5}', '${LIVE}', '${ADMIN}', 'An admin asked this', null, null),
  ('${QSEED}', '${SEEDITEM}', '${ASKER}', 'On a test item', null, null),
  ('${QTESTER}', '${LIVE}', '${TESTER}', 'A tester asked', 'ok', null),
  ('${QNOANS}', '${LIVE}', '${ASKER}', 'Not answered yet', null, null);
create table declutter_wanted(id uuid primary key, user_id uuid, what text, public boolean, removed_at timestamptz, is_seed boolean);
create table messages(id uuid primary key default gen_random_uuid(), sender_id uuid, receiver_id uuid, content text, attachment_url text);
create table reports(id uuid primary key default gen_random_uuid(), reporter_id uuid, reported_type text not null, reported_id uuid not null, reason text not null,
  description text, status text not null default 'pending', reported_content text,
  constraint reports_reported_type_check check (reported_type = any (array['job','message','user','support','review','application','declutter_item','declutter_wanted'])));
create table admin_audit_log(admin_id uuid, action text, target_type text, target_id text, details jsonb);
`);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 1; i <= 3; i++) await db.exec(mig);
  await db.exec(`create trigger trg_report_message_party_and_copy before insert on reports for each row execute function report_message_party_and_copy()`);
}

const as = async (uid, sql) => {
  await db.exec(`select set_config('t.uid', '${uid ?? ""}', false); select set_config('t.role', '${uid ? "authenticated" : "service_role"}', false)`);
  return db.query(sql);
};
const fails = async (uid, sql, code) => { try { await as(uid, sql); return `NO ERROR (wanted ${code})`; } catch (e) { return String(e.message).includes(code) ? "ok" : `wrong: ${e.message}`; } };
const results = {};
const ok = (name, v) => { results[name] = v === true || v === "ok" ? "ok" : `RED ${JSON.stringify(v)}`; };
const safe = async (name, fn) => { try { ok(name, await fn()); } catch (e) { ok(name, String(e.message ?? e)); } };
const report = (uid, q, type = "declutter_question") => as(uid, `insert into reports(reporter_id, reported_type, reported_id, reason) values (${uid ? `'${uid}'` : "null"}, '${type}', '${q}', 'Spam or scam') returning id, reported_content`);
const reportFails = (uid, q, code, type = "declutter_question") => fails(uid, `insert into reports(reporter_id, reported_type, reported_id, reason) values ('${uid}', '${type}', '${q}', 'x')`, code);

let R1 = null;
await safe("a member reports a live listing's question; the report copies the question and answer", async () => {
  const r = (await report(MEMBER, Q1)).rows[0];
  R1 = r?.id;
  return r?.reported_content === "Question: Does it have scratches?\nAnswer: Only one, on the back." || r;
});
await safe("a removed question reads as not found", () => fails(MEMBER, `insert into reports(reporter_id, reported_type, reported_id, reason) values ('${MEMBER}', 'declutter_question', '${QGONE}', 'x')`, "report_target_not_found"));
await safe("a question on a draft the member can't see reads as not found", () => fails(MEMBER, `insert into reports(reporter_id, reported_type, reported_id, reason) values ('${MEMBER}', 'declutter_question', '${QDRAFT}', 'x')`, "report_target_not_found"));
await safe("an unknown id reads as not found", () => fails(MEMBER, `insert into reports(reporter_id, reported_type, reported_id, reason) values ('${MEMBER}', 'declutter_question', gen_random_uuid(), 'x')`, "report_target_not_found"));
await safe("the seller can report a question on their own draft", async () => (await report(SELLER, QDRAFT)).rows.length === 1);
await safe("a member can't see a test listing, so its question reads as not found", () => reportFails(MEMBER, QSEED, "report_target_not_found"));
await safe("the buyer of a sold item can report its question; another member can't", async () =>
  (await report(BUYER, QSOLD)).rows.length === 1 && (await fails(MEMBER, `insert into reports(reporter_id, reported_type, reported_id, reason) values ('${MEMBER}', 'declutter_question', '${QSOLD}', 'x')`, "report_target_not_found")) === "ok");
await safe("a server-side report (no reporter) is taken", async () => (await report(null, QGONE)).rows.length === 1);

let RA = null;
await safe("a member reports the seller's answer; the copy has both", async () => {
  const r = (await report(MEMBER, Q1, "declutter_answer")).rows[0];
  RA = r?.id;
  return r?.reported_content === "Question: Does it have scratches?\nAnswer: Only one, on the back." || r;
});
await safe("an answer report needs an answer", () => reportFails(MEMBER, QNOANS, "report_target_not_found", "declutter_answer"));
await safe("the asker can't report their own question", () => reportFails(ASKER, Q1, "report_own_content"));
await safe("the seller can't report their own answer", () => reportFails(SELLER, Q1, "report_own_content", "declutter_answer"));
await safe("the asker CAN report the seller's answer to them", async () => (await report(ASKER, Q1, "declutter_answer")).rows.length === 1);
await safe("the queue's read: a member is refused", () => fails(MEMBER, `select * from declutter_admin_reported_questions(array['${Q1}']::uuid[])`, "not_admin"));
await safe("the queue's read flags a test listing and a test asker, and nothing else", async () => {
  const rows = (await as(ADMIN, `select question_id::text as id, is_seed, item_title, removed from declutter_admin_reported_questions(array['${Q1}', '${QSEED}', '${QTESTER}', '${QGONE}']::uuid[])`)).rows;
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  return (rows.length === 4 && by[Q1].is_seed === false && by[QSEED].is_seed === true && by[QTESTER].is_seed === true
    && by[QGONE].removed === true && by[Q1].item_title === "Oak dresser") || rows;
});
await safe("an admin removes only the answer: the question stays, waiting again", async () => {
  const r = (await as(ADMIN, `select declutter_admin_remove_question('${Q1}', 'answer', 'rude', '${RA}') as r`)).rows[0]?.r;
  const q = (await db.query(`select answer, answered_at, removed_at from declutter_questions where id = '${Q1}'`)).rows[0];
  const log = (await db.query(`select action, details from admin_audit_log where target_id = '${Q1}' and action = 'declutter_answer_removed'`)).rows[0];
  return (r === "removed" && q.answer === null && q.removed_at === null && log?.details.answer === "Only one, on the back.") || { r, q, log };
});
await safe("a part that is neither is refused", () => fails(ADMIN, `select declutter_admin_remove_question('${Q1}', 'both', 'x', null)`, "invalid_part"));
await safe("a member can't remove a question", () => fails(MEMBER, `select declutter_admin_remove_question('${Q1}', 'question', 'x', '${R1}')`, "not_admin"));
await safe("the report must be for this question", () => fails(ADMIN, `select declutter_admin_remove_question('${QSOLD}', 'question', 'x', '${R1}')`, "report_not_for_question"));
await safe("an admin can't remove a question they asked", () => fails(ADMIN, `select declutter_admin_remove_question('${Q5}', 'question', 'x', null)`, "own_question"));
await safe("an admin removes it: gone for members, the report resolved, the step logged", async () => {
  const r = (await as(ADMIN, `select declutter_admin_remove_question('${Q1}', 'question', 'contact details', '${R1}') as r`)).rows[0]?.r;
  const q = (await db.query(`select removed_at from declutter_questions where id = '${Q1}'`)).rows[0];
  const rp = (await db.query(`select status from reports where id = '${R1}'`)).rows[0];
  const log = (await db.query(`select action, details from admin_audit_log where target_id = '${Q1}' and action = 'declutter_question_removed'`)).rows[0];
  return (r === "removed" && q.removed_at && rp.status === "resolved" && log?.action === "declutter_question_removed" && log.details.note === "contact details") || { r, q, rp, log };
});
await safe("removing it twice says not found", () => fails(ADMIN, `select declutter_admin_remove_question('${Q1}', 'question', 'x', null)`, "question_not_found"));
await safe("other report types keep no copy (job)", async () =>
  (await as(MEMBER, `insert into reports(reporter_id, reported_type, reported_id, reason) values ('${MEMBER}', 'job', gen_random_uuid(), 'x') returning reported_content`)).rows[0].reported_content === null);
await safe("grants: the RPC is not PUBLIC's or anon's", async () => {
  const acls = (await db.query(`select proacl::text as a from pg_proc where proname in ('declutter_admin_remove_question', 'declutter_admin_reported_questions')`)).rows.map((r) => r.a ?? "");
  return (acls.length === 2 && acls.every((acl) => acl.includes("authenticated=X") && !/(^|[{,])=X/.test(acl) && !acl.includes("anon=X"))) || acls;
});

let red = 0;
for (const [k, v] of Object.entries(results)) { console.log(`${v === "ok" ? "ok  " : "RED "} ${k}${v === "ok" ? "" : `: ${v}`}`); if (v !== "ok") red++; }
console.log(red ? `\n${red} RED` : "\nALL OK");
process.exit(red ? 1 : 0);

#!/usr/bin/env node
/**
 * PGlite proof for 20261030042545_declutter_admin_problem_talk_order_chat.sql: the admin problem card reads the
 * paid-order chat too ('order_chat'), that order's only, each line as the side kept on the message.
 *
 *   node src/test/pglite/declutterAdminProblemOrderChat.pglite.mjs                     # ALL OK (applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterAdminProblemOrderChat.pglite.mjs  # red: the checks need it
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterAdminProblemOrderChat.pglite.mjs
 *
 * A stub world shaped as the function reads it (said so inline); the function before this migration is taken
 * verbatim from 20261029005124. pglite is loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}20261030042545_declutter_admin_problem_talk_order_chat.sql`, "utf8");
const before = readFileSync(`${MIG_DIR}20261029005124_declutter_admin_problem_talk.sql`, "utf8");
const db = new PGlite();
const ADMIN = "a1111111-1111-4111-8111-111111111111", B = "b2222222-2222-4222-8222-222222222222", S = "c3333333-3333-4333-8333-333333333333";
const O1 = "01000000-0000-4000-8000-000000000001", O2 = "01000000-0000-4000-8000-000000000002";
const PR = "0a000000-0000-4000-8000-000000000001";
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create type app_role as enum ('admin', 'user');
create table admins(user_id uuid);
create function has_role(u uuid, r app_role) returns boolean language sql stable as $$ select r = 'admin' and exists(select 1 from admins where user_id = u) $$;
insert into admins values ('${ADMIN}');
create table declutter_orders(id uuid primary key, buyer_id uuid, seller_id uuid, created_at timestamptz default now() - interval '3 days', paid_at timestamptz default now() - interval '2 days');
insert into declutter_orders(id, buyer_id, seller_id) values ('${O1}', '${B}', '${S}'), ('${O2}', '${B}', '${S}');
create table declutter_problems(id uuid primary key, order_id uuid);
insert into declutter_problems values ('${PR}', '${O1}');
create table declutter_cart_items(id uuid primary key default gen_random_uuid(), order_id uuid, item_id uuid, created_at timestamptz default now() - interval '3 days');
insert into declutter_cart_items(order_id, item_id) values ('${O1}', gen_random_uuid());
create table declutter_handover_talks(id uuid primary key default gen_random_uuid(), buyer_id uuid, seller_id uuid, opened_at timestamptz);
create table declutter_handover_talk_messages(id uuid primary key default gen_random_uuid(), talk_id uuid, sender_id uuid, body text, created_at timestamptz);
create table declutter_questions(id uuid primary key default gen_random_uuid(), item_id uuid, asker_id uuid, question text, created_at timestamptz, answer text, answered_at timestamptz, removed_at timestamptz);
-- The order-chat tables as 20261030004216 makes them (the columns this function reads).
create table declutter_order_talks(id uuid primary key default gen_random_uuid(), order_id uuid unique);
create table declutter_order_talk_messages(id uuid primary key default gen_random_uuid(), talk_id uuid, sender_id uuid, sender_side text, body text, created_at timestamptz default now());
`);
await db.exec(before.match(/CREATE OR REPLACE FUNCTION public\.declutter_admin_problem_talk[\s\S]*?\$fn\$;/)[0]);
// One chat per order: O1's (the problem's order) and O2's (another sale between the same two people).
await db.exec(`
insert into declutter_order_talks(id, order_id) values ('0c000000-0000-4000-8000-000000000001', '${O1}'), ('0c000000-0000-4000-8000-000000000002', '${O2}');
insert into declutter_order_talk_messages(talk_id, sender_id, sender_side, body, created_at) values
  ('0c000000-0000-4000-8000-000000000001', '${B}', 'buyer', 'It arrived cracked.', now() - interval '1 day'),
  ('0c000000-0000-4000-8000-000000000001', null, 'seller', 'Sorry, I can refund.', now() - interval '20 hours'),
  ('0c000000-0000-4000-8000-000000000002', '${B}', 'buyer', 'Other sale, other chat.', now() - interval '1 day');
`);
if (process.env.NEW_MIGRATION !== "skip") for (let i = 1; i <= 3; i++) await db.exec(mig);

const as = async (uid, sql) => { await db.exec(`select set_config('t.uid', '${uid ?? ""}', false)`); return db.query(sql); };
const rowsOf = async (uid) => { try { return (await as(uid, `select * from declutter_admin_problem_talk('${PR}')`)).rows; } catch (e) { return { error: String(e.message ?? e) }; } };
const r = {};
const rows = await rowsOf(ADMIN);
const chat = Array.isArray(rows) ? rows.filter((x) => x.kind === "order_chat") : [];
r.orderChatShown = chat.length === 2 ? "ok" : JSON.stringify(rows);
r.onlyThisOrder = chat.every((x) => x.body !== "Other sale, other chat.") ? "ok" : "bad (another order's chat leaked in)";
r.sidesKept = JSON.stringify(chat.map((x) => [x.side, x.body])) === JSON.stringify([["buyer", "It arrived cracked."], ["seller", "Sorry, I can refund."]]) ? "ok" : JSON.stringify(chat);
r.deletedSenderStillASide = chat[1]?.side === "seller" ? "ok" : "bad";
r.noIds = chat.every((x) => !/^[0-9a-f-]{36}$/.test(String(x.side))) ? "ok" : "bad";
const member = await rowsOf(B);
r.memberRefused = !Array.isArray(member) && /not_admin/.test(member.error) ? "ok" : JSON.stringify(member);
const anon = (await db.query(`select has_function_privilege('anon', 'declutter_admin_problem_talk(uuid)', 'execute') v`)).rows[0].v;
r.noAnon = anon ? "bad" : "ok";
const bad = Object.entries(r).filter(([, v]) => v !== "ok");
console.log(JSON.stringify(r, null, 1));
console.log(bad.length ? `FAILED (${bad.length}): ${bad.map(([k]) => k).join(", ")}` : `ALL OK (${Object.keys(r).length} checks; applied 3x)`);
process.exit(bad.length ? 1 : 0);

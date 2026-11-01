#!/usr/bin/env node
/**
 * PGlite proof for *_declutter_manager_mode (owner 11-01 9:54 AM, "Manage my Declutter for me", phase 1: data and
 * access). A seller (Kaci) asks one person (the manager) by a private direct offer; the manager accepts; the
 * manager then acts on the seller's SELLING side only, and only in the parts the seller turned on.
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/declutterManagerMode.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterManagerMode.pglite.mjs   # RED: without the migration
 *
 * World: the declutter tables the path touches (real columns), auth.uid() exactly as Supabase defines it (claim.sub
 * OR request.jwt.claims ->> 'sub'), and the NEWEST real bodies of declutter_answer_question and
 * declutter_send_order_message read from the migrations, so "acts as the seller" is proved through the seller's own
 * RPCs. Stubs (said so): require_feature (a switch table), is_caller_banned (a per-user list), are_users_blocked
 * (a table), declutter_assert_member, declutter_notify (records), the order-talk helpers declutter_lock_order /
 * declutter_order_side / declutter_order_talk_until, and every OTHER seller RPC the dispatcher names, each a recorder
 * that writes (action, auth.uid()) so the proof sees who the RPC ran as. The migration runs verbatim 3x.
 */
import { readdirSync } from "node:fs";
import { PGlite, readMigration, newestFunctionSql, checker, refused, USERS } from "./seriesWorld.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const FILE = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_manager_mode.sql"));
if (!FILE) throw new Error("migration *_declutter_manager_mode.sql not found");
const VERSION = FILE.slice(0, 14);
const FIX = readMigration(FILE);
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: running without the migration (expect FAILs)");
const { P: K, A: M, B: N, X } = USERS; // K = Kaci (seller), M = manager, N = another member, X = a buyer
const { check, failures } = checker();

// Every seller RPC declutter_manage names, with its real signature; the two loaded for real are left out.
const RECORDERS = [
  ["declutter_create_item_with_id", "p_item_id uuid, a text, b text, c text, d integer, e text, f integer, g integer, h text, i text, j numeric, k numeric", "uuid", "p_item_id"],
  ["declutter_update_draft", "p_item_id uuid, a text, b text, c text, d integer, e text, f integer, g integer, h text, i text, j numeric, k numeric", "timestamptz", "now()"],
  ["declutter_remove_item_photo", "p_photo_id uuid", "text", "'removed'"],
  ["declutter_attest_item", "p_item_id uuid, a boolean, b boolean, c boolean, d boolean", "timestamptz", "now()"],
  ["declutter_publish_item", "p_item_id uuid", "text", "'pending_review'"],
  ["declutter_edit_listing", "p_item_id uuid, a text, b text, c text, d integer, e text, f text[], g boolean, h boolean, i boolean, j boolean", "text", "'saved'"],
  ["declutter_set_handovers", "p_item_id uuid, p text[]", "text[]", "p"],
  ["declutter_pause_listing", "p_item_id uuid", "text", "'paused'"],
  ["declutter_withdraw_item", "p_item_id uuid", "text[]", "array['withdrawn']"],
  ["declutter_set_listing_price", "p_item_id uuid, a integer, b integer", "integer", "a"],
  ["declutter_set_listing_drops", "p_item_id uuid, a boolean", "boolean", "a"],
  ["declutter_relist_listing", "p_item_id uuid", "text", "'live'"],
  ["declutter_reopen_listing", "p_item_id uuid", "text", "'live'"],
  ["declutter_respond_offer", "p_offer_id uuid, a text, b integer", "text", "a"],
  ["declutter_set_offer_rules", "p_item_id uuid, a boolean, b boolean", "void", null],
  ["declutter_set_pickup_windows", "p jsonb", "integer", "jsonb_array_length(p)"],
  ["declutter_confirm_handover", "p_order_id uuid, a text, b text", "jsonb", "jsonb_build_object('ok', true)"],
  ["declutter_order_talk_view", "p_order_id uuid", "jsonb", "jsonb_build_object('messages', '[]'::jsonb)"],
  ["declutter_complete_handover", "p_order_id uuid, a text", "jsonb", "jsonb_build_object('ok', true)"],
].map(([name, args, ret, val]) => `
  create function public.${name}(${args}) returns ${ret} language plpgsql security definer set search_path to 'public' as $f$
  begin
    insert into public.rpc_calls (fn, uid) values ('${name}', auth.uid());
    ${ret === "void" ? "return;" : `return ${val};`}
  end $f$;`).join("\n");

const WORLD = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key);
  insert into auth.users values ('${K}'), ('${M}'), ('${N}'), ('${X}');
  -- Supabase's own definition: the legacy claim, else the JSON claims PostgREST sets.
  create function auth.uid() returns uuid language sql stable as $f$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $f$;
  grant usage on schema auth, public, storage to authenticated, anon, service_role;
  create table storage.objects (bucket_id text, name text, owner uuid, owner_id text, metadata jsonb);
  create table public.profiles (id uuid primary key default gen_random_uuid(), user_id uuid unique, full_name text, is_seed boolean not null default false);
  insert into public.profiles (user_id, full_name) values ('${K}', 'Kaci Lombas'), ('${M}', 'Lexi Lombas'), ('${N}', 'Nora Other'), ('${X}', 'Ben Buyer');
  create table public.feature_switches (key text primary key, audience text, description text);
  insert into public.feature_switches values ('declutter', 'testers', 'd');
  create table public.t_off (key text primary key);
  create function public.require_feature(p text) returns void language plpgsql as $f$
  begin
    if exists (select 1 from public.t_off where key = p) or not exists (select 1 from public.feature_switches where key = p) then
      raise exception 'feature_disabled' using errcode = '42501';
    end if;
  end $f$;
  create table public.t_banned (uid uuid primary key);
  create function public.is_caller_banned() returns boolean language sql stable as $f$ select exists (select 1 from public.t_banned where uid = auth.uid()) $f$;
  create table public.t_blocks (a uuid, b uuid);
  create function public.are_users_blocked(x uuid, y uuid) returns boolean language sql stable as $f$
    select exists (select 1 from public.t_blocks where (a = x and b = y) or (a = y and b = x)) $f$;
  create function public.declutter_assert_member(boolean) returns void language sql as $f$ select $f$;
  create table public.notices (user_id uuid, kind text, title text, body text, link text);
  create function public.declutter_notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_actor uuid default null)
    returns void language sql security definer as $f$ insert into public.notices values (p_user, p_kind, p_title, p_body, p_link) $f$;
  create table public.rpc_calls (fn text, uid uuid);

  create table public.declutter_items (id uuid primary key default gen_random_uuid(), seller_id uuid not null references auth.users(id),
    sale_mode text not null default 'offers', status text not null default 'draft', title text not null,
    description text not null default '', category text not null, condition_stars smallint not null, delivery_size text not null,
    price_cents integer not null, current_price_cents integer not null, area_label text not null, area_lat numeric(5,2) not null,
    area_lng numeric(6,2) not null, is_seed boolean not null default false, created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(), live_at timestamptz);
  create table public.declutter_item_photos (id uuid primary key default gen_random_uuid(),
    item_id uuid not null references public.declutter_items(id) on delete cascade, seller_id uuid not null,
    storage_path text not null unique, position smallint not null, created_at timestamptz not null default now(),
    unique (item_id, position));
  create table public.declutter_questions (id uuid primary key default gen_random_uuid(),
    item_id uuid not null references public.declutter_items(id) on delete cascade, asker_id uuid not null references auth.users(id),
    question text not null, answer text, answered_at timestamptz, removed_at timestamptz, created_at timestamptz not null default now());
  create table public.declutter_offers (id uuid primary key default gen_random_uuid(),
    item_id uuid not null references public.declutter_items(id) on delete cascade, buyer_id uuid not null, seller_id uuid not null,
    amount_cents integer not null, awaiting text not null, status text not null default 'open', respond_by timestamptz not null default now() + interval '2 days');
  create table public.declutter_orders (id uuid primary key default gen_random_uuid(), buyer_id uuid not null, seller_id uuid not null,
    status text not null default 'paid', handover text not null default 'pickup_home', items_cents integer not null default 1000,
    premium_cents integer not null default 150, tax_cents integer not null default 0, total_cents integer not null default 1150,
    is_seed boolean not null default false, created_at timestamptz not null default now(), paid_at timestamptz default now(), closed_at timestamptz);
  create table public.declutter_cart_items (id uuid primary key default gen_random_uuid(), item_id uuid, order_id uuid, created_at timestamptz not null default now());
  create table public.declutter_order_talks (id uuid primary key default gen_random_uuid(), order_id uuid not null unique references public.declutter_orders(id),
    created_at timestamptz not null default now(), buyer_notified_at timestamptz, seller_notified_at timestamptz);
  create table public.declutter_order_talk_messages (id uuid primary key default gen_random_uuid(),
    talk_id uuid not null references public.declutter_order_talks(id), sender_id uuid, sender_side text not null,
    body text not null, created_at timestamptz not null default now());
  create function public.declutter_lock_order(p uuid) returns public.declutter_orders language sql as $f$
    select * from public.declutter_orders where id = p for update $f$;
  create function public.declutter_order_side(b uuid, s uuid, u uuid) returns text language sql immutable as $f$
    select case when u = b then 'buyer' when u = s then 'seller' end $f$;
  create function public.declutter_order_talk_until(p uuid) returns timestamptz language sql stable as $f$ select now() + interval '1 day' $f$;
  grant select on all tables in schema public to authenticated;
  grant all on all tables in schema public to service_role;
  ${RECORDERS}
`;
const REAL = ["declutter_answer_question", "declutter_send_order_message"].map((n) => newestFunctionSql(n, VERSION));

const db = new PGlite();
await db.exec(WORLD + REAL.map((r) => r.sql).join("\n"));
console.log(`real seller RPCs: ${REAL.map((r) => r.file).join(", ")}`);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(FIX);
check("applies 3x (replay-safe)", true);
await db.exec(`insert into public.feature_switches values ('declutter_manager', 'testers', 'x') on conflict do nothing`);

/** As `uid` the way PostgREST does it today: request.jwt.claims JSON only. */
async function as(uid, sql) {
  try {
    await db.exec(`set request.jwt.claims = '{"sub":"${uid}","role":"authenticated"}'; set role authenticated;`);
    const out = await db.query(sql);
    await db.exec(`reset role; reset request.jwt.claims;`);
    return { ok: true, rows: out.rows };
  } catch (e) {
    await db.exec(`reset role; reset request.jwt.claims;`);
    return { ok: false, err: String(e.message).split("\n")[0] };
  }
}
const q1 = async (sql) => {
  try {
    return (await db.query(sql)).rows[0];
  } catch (e) {
    // NEW_MIGRATION=skip: a table the migration creates is missing; the check reading it then FAILs on undefined.
    if (SKIP) return undefined;
    throw e;
  }
};
const offer = (by, to, type = "percent", value = 20, parts = "true, false, false, false, false") =>
  as(by, `select public.declutter_manager_offer('${to}', '${type}', ${value}, ${parts}) as id`);
const respond = (by, g, yes) => as(by, `select public.declutter_manager_respond('${g}', ${yes}) as s`);
const manage = (by, seller, action, args) =>
  as(by, `select public.declutter_manage('${seller}', '${action}', '${JSON.stringify(args)}'::jsonb) as r`);
const lastCall = async () => (await db.query(`select fn, uid from public.rpc_calls order by ctid desc limit 1`)).rows[0];

// ── The offer ─────────────────────────────────────────────────────────────────
let r = await offer(K, M, "percent", 20, "true, false, false, false, false");
check("seller sends the private offer (Listing only, 20%)", r.ok, r.err);
const g1 = r.rows?.[0]?.id;
const notice = await q1(`select title, body, link from public.notices where user_id = '${M}' order by ctid desc limit 1`);
check("the person is told \"Kaci asked you to manage their Declutter\" with the share and the parts",
  notice?.title === "Kaci asked you to manage their Declutter" && /listing/.test(notice?.body ?? "") && /20% of each sale/.test(notice?.body ?? ""),
  JSON.stringify(notice));
check("a second open offer from the same seller is refused", refused(await offer(K, N), /already_has_manager/));
check("no offer to yourself", refused(await offer(K, K), /manager_not_found/));
check("no offer with nothing chosen", refused(await offer(N, K, "percent", 10, "false, false, false, false, false"), /no_parts_chosen/));
check("no percent over 100", refused(await offer(N, K, "percent", 101), /invalid_share/));
check("no negative flat share", refused(await offer(N, K, "flat", -1), /invalid_share/));
await db.exec(`insert into public.t_blocks values ('${N}', '${X}')`);
check("no offer across a block", refused(await offer(N, X), /manager_blocked/));
await db.exec(`insert into public.t_off values ('declutter_manager')`);
check("switch off: the offer is refused (feature_disabled)", refused(await offer(N, M), /feature_disabled/));
await db.exec(`delete from public.t_off`);

// ── Acting before acceptance ─────────────────────────────────────────────────
const item = (await q1(`insert into public.declutter_items (seller_id, status, title, category, condition_stars, delivery_size,
    price_cents, current_price_cents, area_label, area_lat, area_lng) values ('${K}', 'live', 'Oak dresser', 'furniture', 4, 'large',
    12000, 12000, 'Mid City', 30.45, -91.18) returning id`)).id;
check("before accepting, the manager can do nothing", refused(await manage(M, K, "pause_listing", { item_id: item }), /not_your_seller/));
check("only the person offered can answer", refused(await respond(N, g1, true), /not_your_offer/));
r = await respond(M, g1, true);
check("the manager accepts", r.ok && r.rows[0].s === "active", r.err ?? r.rows?.[0]?.s);
check("the seller is told", !!(await q1(`select 1 as x from public.notices where user_id = '${K}' and title = 'Lexi is managing your Declutter'`)));
check("an accepted offer can't be answered again", refused(await respond(M, g1, false), /offer_not_pending/));

// ── Listing permission: allowed, and runs AS THE SELLER ─────────────────────
r = await manage(M, K, "pause_listing", { item_id: item });
let call = await lastCall();
check("Listing on: the manager pauses the seller's live listing", r.ok, r.err);
check("...and the seller's own RPC ran as the SELLER", call?.fn === "declutter_pause_listing" && call?.uid === K, JSON.stringify(call));
// Owner 11-01: "the manager should draft up everything, then send to the seller for approval before posting."
for (const a of ["publish_item", "attest_item", "relist_listing", "reopen_listing"]) {
  check(`the manager can never ${a} (only the seller posts)`, refused(await manage(M, K, a, { item_id: item }), /unknown_action/));
}
const newId = "77777777-7777-7777-7777-777777777777";
r = await manage(M, K, "create_item", { item_id: newId, title: "Lamp", price_cents: 2000, floor_price_cents: 1000 });
call = await lastCall();
check("Listing on: create a listing on the seller's account (as the seller)", r.ok && call?.uid === K, r.err ?? JSON.stringify(call));
check("create refuses an id that already exists (no taking over another item)",
  refused(await manage(M, K, "create_item", { item_id: item }), /not_found/));
const after = await as(M, `select auth.uid() as u`);
check("after the call the caller is the manager again", after.rows?.[0]?.u === M, JSON.stringify(after.rows));

// ── Listing only: no messages, no offers, no prices, no pickups ─────────────
const qid = (await q1(`insert into public.declutter_questions (item_id, asker_id, question) values ('${item}', '${X}', 'Still there?') returning id`)).id;
const off = (await q1(`insert into public.declutter_offers (item_id, buyer_id, seller_id, amount_cents, awaiting) values ('${item}', '${X}', '${K}', 9000, 'seller') returning id`)).id;
const ord = (await q1(`insert into public.declutter_orders (buyer_id, seller_id) values ('${X}', '${K}') returning id`)).id;
check("Listing only: can't answer a buyer's question", refused(await manage(M, K, "answer_question", { question_id: qid, answer: "Yes" }), /permission_off/));
check("Listing only: can't write in an order chat", refused(await manage(M, K, "send_order_message", { order_id: ord, body: "Hi" }), /permission_off/));
check("Listing only: can't answer an offer", refused(await manage(M, K, "respond_offer", { offer_id: off, action: "accept" }), /permission_off/));
check("Listing only: can't change a price", refused(await manage(M, K, "set_listing_price", { item_id: item, price_cents: 1 }), /permission_off/));
check("Listing only: can't touch pickups", refused(await manage(M, K, "set_pickup_windows", { windows: [] }), /permission_off/));
check("an unknown action is refused", refused(await manage(M, K, "set_payout_account", {}), /unknown_action/));
check("a stranger can't act for the seller", refused(await manage(N, K, "pause_listing", { item_id: item }), /not_your_seller/));

// ── The seller turns on Messages and Offers ──────────────────────────────────
check("only the seller changes the parts",
  refused(await as(M, `select public.declutter_manager_set_permissions('${g1}', true, true, true, true, true)`), /not_your_grant/));
r = await as(K, `select public.declutter_manager_set_permissions('${g1}', true, false, true, true, false)`);
check("the seller turns on Offers and Messages", r.ok, r.err);
r = await manage(M, K, "answer_question", { question_id: qid, answer: "Yes, still here" });
const ans = await q1(`select answer from public.declutter_questions where id = '${qid}'`);
check("Messages on: the manager answers through the seller's REAL answer RPC", r.ok && ans?.answer === "Yes, still here", r.err ?? JSON.stringify(ans));
r = await manage(M, K, "send_order_message", { order_id: ord, body: "Pickup is at 5" });
const msg = await q1(`select id, sender_id, sender_side from public.declutter_order_talk_messages order by created_at desc limit 1`);
check("Messages on: the order message is the SELLER'S side (real RPC)", r.ok && msg?.sender_id === K && msg?.sender_side === "seller", r.err ?? JSON.stringify(msg));
const lab = await as(X, `select label from public.declutter_manager_message_labels('order_talk', array['${msg?.id}']::uuid[])`);
check("the buyer sees it labeled \"Lexi (helping Kaci)\"", lab.rows?.[0]?.label === "Lexi (helping Kaci)", JSON.stringify(lab.rows ?? lab.err));
const labN = await as(N, `select label from public.declutter_manager_message_labels('order_talk', array['${msg?.id}']::uuid[])`);
check("a stranger gets no label for someone else's order chat", labN.ok && labN.rows.length === 0, JSON.stringify(labN.rows ?? labN.err));
const labA = await as(X, `select label from public.declutter_manager_message_labels('answer', array['${qid}']::uuid[])`);
check("an answer the manager wrote is labeled too", labA.rows?.[0]?.label === "Lexi (helping Kaci)", JSON.stringify(labA.rows ?? labA.err));
r = await manage(M, K, "respond_offer", { offer_id: off, action: "accept" });
call = await lastCall();
check("Offers on: the manager answers an offer on the seller's item, as the seller", r.ok && call?.uid === K, r.err ?? JSON.stringify(call));

// ── Never the seller's BUYING side, never another seller ────────────────────
const nItem = (await q1(`insert into public.declutter_items (seller_id, status, title, category, condition_stars, delivery_size,
    price_cents, current_price_cents, area_label, area_lat, area_lng) values ('${N}', 'live', 'Chair', 'furniture', 3, 'small',
    3000, 3000, 'Mid City', 30.45, -91.18) returning id`)).id;
const kBuys = (await q1(`insert into public.declutter_orders (buyer_id, seller_id) values ('${K}', '${N}') returning id`)).id;
const kOffer = (await q1(`insert into public.declutter_offers (item_id, buyer_id, seller_id, amount_cents, awaiting) values ('${nItem}', '${K}', '${N}', 2000, 'buyer') returning id`)).id;
check("can't write in an order where the seller is the BUYER", refused(await manage(M, K, "send_order_message", { order_id: kBuys, body: "x" }), /not_found/));
check("can't answer an offer the seller MADE as a buyer", refused(await manage(M, K, "respond_offer", { offer_id: kOffer, action: "accept" }), /not_found/));
check("can't pause another member's item", refused(await manage(M, K, "pause_listing", { item_id: nItem }), /not_found/));
check("can't name another seller", refused(await manage(M, N, "pause_listing", { item_id: nItem }), /not_your_seller/));

// ── Photos: the manager's own upload, on the seller's draft ─────────────────
const draft = (await q1(`insert into public.declutter_items (seller_id, status, title, category, condition_stars, delivery_size,
    price_cents, current_price_cents, area_label, area_lat, area_lng) values ('${K}', 'draft', 'Rug', 'decor', 4, 'medium',
    4000, 4000, 'Mid City', 30.45, -91.18) returning id`)).id;
await db.query(`insert into storage.objects values ('job-photos', '${M}/declutter/${draft}/a.jpg', '${M}', '${M}', '{"mimetype":"image/jpeg","size":"1000"}')`);
await db.query(`insert into storage.objects values ('job-photos', '${N}/declutter/${draft}/b.jpg', '${N}', '${N}', '{"mimetype":"image/jpeg","size":"1000"}')`);
r = await manage(M, K, "add_item_photo", { item_id: draft, storage_path: `${M}/declutter/${draft}/a.jpg` });
const ph = await q1(`select seller_id from public.declutter_item_photos where item_id = '${draft}'`);
check("Listing on: the manager's own photo goes on the seller's draft", r.ok && ph?.seller_id === K, r.err ?? JSON.stringify(ph));
check("someone else's upload is refused",
  refused(await manage(M, K, "add_item_photo", { item_id: draft, storage_path: `${N}/declutter/${draft}/b.jpg` }), /photo_not_uploaded/));

await db.query(`insert into storage.objects values ('job-photos', '${M}/declutter/${draft}/c.jpg', '${N}', '${N}', '{"mimetype":"image/jpeg","size":"1000"}')`);
await db.query(`insert into storage.objects values ('job-photos', '${N}/declutter/${draft}/d.jpg', '${M}', '${M}', '{"mimetype":"image/jpeg","size":"1000"}')`);
check("a file in the manager's folder that someone else uploaded is refused",
  refused(await manage(M, K, "add_item_photo", { item_id: draft, storage_path: `${M}/declutter/${draft}/c.jpg` }), /photo_not_uploaded/));
check("the manager's own upload outside their folder is refused",
  refused(await manage(M, K, "add_item_photo", { item_id: draft, storage_path: `${N}/declutter/${draft}/d.jpg` }), /photo_not_uploaded/));

// ── Owner 11-01: the manager drafts, the seller approves before posting ─────
check("a live listing can't be sent for approval", refused(await manage(M, K, "submit_for_approval", { item_id: item }), /item_not_editable/));
check("another member's draft can't be sent", refused(await manage(M, K, "submit_for_approval", { item_id: nItem }), /not_found/));
r = await manage(M, K, "submit_for_approval", { item_id: draft });
const sub1 = await q1(`select status from public.declutter_manager_submissions where item_id = '${draft}'`);
const okNotice = await q1(`select title, body from public.notices where user_id = '${K}' order by ctid desc limit 1`);
check("the manager sends the draft: it waits for the seller", r.ok && sub1?.status === "waiting", r.err ?? JSON.stringify(sub1));
check("the seller is told with the next step: \"Lexi listed 1 item for you. Review and post it.\"",
  okNotice?.title === "Waiting for your OK" && okNotice?.body === "Lexi listed 1 item for you. Review and post it.", JSON.stringify(okNotice));
check("while it waits, the manager can't change it", refused(await manage(M, K, "update_draft", { item_id: draft, title: "x" }), /waiting_for_seller/));
check("...or its photos", refused(await manage(M, K, "add_item_photo", { item_id: draft, storage_path: `${M}/declutter/${draft}/a.jpg` }), /waiting_for_seller/));
check("...or send it twice", refused(await manage(M, K, "submit_for_approval", { item_id: draft }), /waiting_for_seller/));
const ATT = "true, true, true, true";
check("the manager can't approve it", refused(await as(M, `select public.declutter_manager_approve('${draft}', ${ATT})`), /not_found/));
check("a stranger can't approve it", refused(await as(N, `select public.declutter_manager_approve('${draft}', ${ATT})`), /not_found/));
check("the manager can't send it back", refused(await as(M, `select public.declutter_manager_send_back('${draft}', 'x')`), /not_found/));
r = await as(K, `select public.declutter_manager_send_back('${draft}', '  Add a photo of the back  ') as s`);
const sub2 = await q1(`select status, note from public.declutter_manager_submissions where item_id = '${draft}'`);
const backNotice = await q1(`select title, body from public.notices where user_id = '${M}' order by ctid desc limit 1`);
check("the seller sends it back with a note", r.ok && sub2?.status === "sent_back" && sub2?.note === "Add a photo of the back", r.err ?? JSON.stringify(sub2));
check("the manager is told, with the note and the next step",
  backNotice?.title === "Sent back to you" && backNotice?.body === 'Kaci sent Rug back: "Add a photo of the back". Change it, then send it for approval again.', JSON.stringify(backNotice));
r = await manage(M, K, "update_draft", { item_id: draft, title: "Rug" });
check("sent back: the manager can change it again", r.ok, r.err);
r = await manage(M, K, "submit_for_approval", { item_id: draft });
check("...and send it again", r.ok && (await q1(`select status from public.declutter_manager_submissions where item_id = '${draft}'`))?.status === "waiting", r.err);
await db.exec(`delete from public.rpc_calls`);
r = await as(K, `select public.declutter_manager_approve('${draft}', ${ATT}) as a`);
const ran = (await db.query(`select fn, uid from public.rpc_calls order by ctid`)).rows;
check("the seller approves: SHE attests and it posts, both as her",
  r.ok && ran.length === 2 && ran[0].fn === "declutter_attest_item" && ran[1].fn === "declutter_publish_item" && ran.every((x) => x.uid === K),
  r.err ?? JSON.stringify(ran));
check("approved, logged as the seller's decision",
  (await q1(`select status from public.declutter_manager_submissions where item_id = '${draft}'`))?.status === "approved"
    && !!(await q1(`select 1 as x from public.declutter_manager_actions where action = 'seller_approved' and target_id = '${draft}' and seller_id = '${K}'`)));
check("the manager is told it is live", !!(await q1(`select 1 as x from public.notices where user_id = '${M}' and title = 'Posted' and body = 'Kaci posted Rug. It is live now.'`)));
check("an approved draft can't be approved again", refused(await as(K, `select public.declutter_manager_approve('${draft}', ${ATT})`), /not_waiting/));
const subSeen = await as(N, `select count(*)::int as n from public.declutter_manager_submissions`);
check("a stranger reads no submission", subSeen.ok && subSeen.rows[0].n === 0, JSON.stringify(subSeen.rows ?? subSeen.err));
check("nobody writes a submission directly", refused(await as(M, `insert into public.declutter_manager_submissions (item_id, grant_id, seller_id, manager_id) values ('${draft}', '${g1}', '${K}', '${M}')`), /permission denied/));

// ── A failed seller RPC leaves the caller the manager ──────────────────────
r = await as(M, `do $d$ begin
    begin perform public.declutter_manage('${K}', 'answer_question', '{"question_id":"${qid}","answer":""}'::jsonb);
    exception when others then null; end;
    if auth.uid() is distinct from '${M}'::uuid then raise exception 'still_acting_as_seller'; end if;
  end $d$`);
check("after a refused seller RPC, auth.uid() is the manager again", r.ok, r.err);

r = await as(M, `do $d$ begin
    perform public.declutter_manage('${K}', 'set_offer_rules', '{"item_id":"${item}","accepts_offers":true}'::jsonb);
    if auth.uid() is distinct from '${M}'::uuid then raise exception 'still_acting_as_seller'; end if;
  end $d$`);
check("after a successful action, in the same transaction, auth.uid() is the manager again", r.ok, r.err);

// ── What the manager sees ────────────────────────────────────────────────────
let ov = await as(M, `select public.declutter_managed_overview('${K}') as o`);
let o = ov.rows?.[0]?.o;
check("overview: the seller's own listings only", ov.ok && o.items.length === 2 && o.items.every((i) => i.title !== "Chair"), JSON.stringify(ov.err ?? o?.items?.map((i) => i.title)));
check("overview: offers on her items only (Offers on)", o?.offers?.length === 1 && o.offers[0].id === off, JSON.stringify(o?.offers));
check("overview: her sales as the SELLER only, never her purchases", o?.orders?.length === 1 && o.orders[0].id === ord, JSON.stringify(o?.orders));
check("a stranger gets no overview", refused(await as(N, `select public.declutter_managed_overview('${K}')`), /not_your_seller/));
await as(K, `select public.declutter_manager_set_permissions('${g1}', true, false, false, false, false)`);
o = (await as(M, `select public.declutter_managed_overview('${K}') as o`)).rows?.[0]?.o;
check("overview, Listing only: no offers, questions or sales", o?.offers?.length === 0 && o?.questions?.length === 0 && o?.orders?.length === 0, JSON.stringify(o && [o.offers, o.questions, o.orders]));
check("Listing only: can't read an order chat", refused(await manage(M, K, "order_talk_view", { order_id: ord }), /permission_off/));
await as(K, `select public.declutter_manager_set_permissions('${g1}', true, false, true, true, false)`);

// ── Restricted manager, private tables, ending ──────────────────────────────
await db.exec(`insert into public.t_banned values ('${M}')`);
check("a restricted manager can't act", refused(await manage(M, K, "pause_listing", { item_id: item }), /account_restricted/));
await db.exec(`delete from public.t_banned`);
check("the action log is private", refused(await as(M, `select count(*) from public.declutter_manager_actions`), /permission denied/));
check("the message labels table is private", refused(await as(X, `select count(*) from public.declutter_manager_messages`), /permission denied/));
const seen = await as(N, `select count(*)::int as n from public.declutter_manager_grants`);
check("a stranger reads no grant", seen.ok && seen.rows[0].n === 0, JSON.stringify(seen.rows ?? seen.err));
const mine = await as(M, `select role, seller_first_name, status, can_list, can_offers from public.declutter_my_manager_grants()`);
check("the manager's switcher row: Managing for Kaci", mine.rows?.[0]?.seller_first_name === "Kaci" && mine.rows[0].role === "manager", JSON.stringify(mine.rows ?? mine.err));
check("only the two people can end it", refused(await as(N, `select public.declutter_manager_end('${g1}')`), /not_your_grant/));
await db.exec(`insert into public.t_off values ('declutter_manager')`);
r = await as(K, `select public.declutter_manager_end('${g1}') as s`);
check("the seller ends access, even with the switch off", r.ok && r.rows[0].s === "ended", r.err ?? r.rows?.[0]?.s);
await db.exec(`delete from public.t_off`);
check("after ending, the manager can do nothing", refused(await manage(M, K, "pause_listing", { item_id: item }), /not_your_seller/));
check("the manager is told", !!(await q1(`select 1 as x from public.notices where user_id = '${M}' and title = 'Declutter managing ended'`)));
r = await offer(K, N, "flat", 500, "false, false, false, false, true");
check("after ending, the seller may ask someone new (flat $5 per item, Pickups only)", r.ok, r.err);
r = await as(K, `select public.declutter_manager_end('${r.rows?.[0]?.id}') as s`);
check("taking back an unanswered offer is 'withdrawn'", r.rows?.[0]?.s === "withdrawn", r.err ?? r.rows?.[0]?.s);

const n = failures();
console.log(n ? `\n${n} FAILED` : "\nall passed");
process.exit(n ? 1 : 0);

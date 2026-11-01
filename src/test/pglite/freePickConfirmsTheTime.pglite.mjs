#!/usr/bin/env node
/**
 * PGlite proof for *_free_pick_confirms_the_asked_time (owner 11-01, Mockup 3): when the giver picks an asker, the
 * time that asker chose becomes the confirmed pickup (a $0 'free' order, paid at once, booked at that time, at a place
 * open then); asks without a time, or whose time can no longer be confirmed, keep the old 48-hour cart path.
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/freePickConfirmsTheTime.pglite.mjs
 *   MUTANT=notime|idcheck|place|booking|porchday|past|window,ordercheck node src/test/pglite/freePickConfirmsTheTime.pglite.mjs   # each must FAIL
 *
 * World: the tables the functions touch, with the columns they use; the NEWEST definitions before the migration of
 * declutter_take_item, declutter_hold_length, declutter_price_text, declutter_slot_in_windows,
 * declutter_place_windows_fill, declutter_order_slot_in_windows and declutter_pick_free_request, read from the
 * migrations, never retyped; B99's pickup_at column (20261101174857) as a column. Stubs: require_feature,
 * is_caller_banned (false), declutter_assert_member (auth.uid()), are_users_blocked, declutter_member_out,
 * seed_hidden_for (false), has_role (false), identity_check_exempt / is_identity_verified (a table), and
 * declutter_new_handover_code, declutter_notify (records). The migration then runs verbatim 3x (or once mutated).
 */
import { readdirSync } from "node:fs";
import { PGlite, readMigration, newestFunctionSql, as, checker, refused, USERS } from "./seriesWorld.mjs";

const FILE = readdirSync(new URL("../../../supabase/migrations/", import.meta.url).pathname).find((f) => f.endsWith("_free_pick_confirms_the_asked_time.sql"));
if (!FILE) throw new Error("migration *_free_pick_confirms_the_asked_time.sql not found");
const VERSION = FILE.slice(0, 14);
let FIX = readMigration(FILE);
const MUTANTS = {
  // The asked time is ignored: every pick takes the old 48-hour path.
  notime: ["  IF v_req.pickup_at IS NOT NULL\n", "  IF false AND v_req.pickup_at IS NOT NULL\n"],
  // The picked person's ID check is skipped (an order made by the giver never meets declutter_identity_gate).
  idcheck: ["OR public.is_identity_verified(v_req.requester_id))", "OR true)"],
  // Any place is used, open at that time or not.
  place: ["AND v_local::time <= (e ->> 'ends')::time - interval '30 minutes')\n       ORDER BY", "OR true)\n       ORDER BY"],
  // A giver with no places: the usual times are not checked.
  window: ["OR (NOT v_has_places AND public.declutter_slot_in_windows(v_uid, v_req.pickup_at))", "OR (NOT v_has_places)"],
  // The order is made but nothing is booked.
  booking: ["VALUES (v_order, v_req.requester_id, v_uid, v_req.pickup_at, v_req.pickup_at + interval '30 minutes');",
    "SELECT v_order, v_req.requester_id, v_uid, v_req.pickup_at, v_req.pickup_at + interval '30 minutes' WHERE false;"],
  // A giver with no places: porch on any day, not only their porch days.
  porchday: ["\n                     AND (v_has_places OR COALESCE(public.declutter_is_porch_day(v_uid, extract(dow FROM v_local)::smallint), false))", ""],
  // The order's own check is skipped.
  ordercheck: ["IF NOT public.declutter_order_slot_in_windows(v_order, v_uid, v_req.pickup_at) THEN", "IF false THEN"],
  // L29: the picked person's admin role read through has_role, which answers only about the caller (false for a giver).
  adminrole: ["EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = v_req.requester_id AND ur.role = 'admin')",
    "public.has_role(v_req.requester_id, 'admin')"],
  // A time already past is booked.
  past: ["     AND v_req.pickup_at > now()\n", ""],
};
const MUTANT = process.env.MUTANT;
// The hours are checked twice on purpose (before anything is made, then the order's own check, which rolls back):
// "window" and "ordercheck" each survive alone and must FAIL together (MUTANT=window,ordercheck).
if (MUTANT) {
  for (const m of MUTANT.split(",")) {
    const [find, repl] = MUTANTS[m] ?? [];
    if (!find || !FIX.includes(find)) throw new Error(`mutant ${m}: text not found in the migration`);
    FIX = FIX.replace(find, repl);
  }
  console.log(`MUTANT=${MUTANT}: expect FAILs`);
}
const { P: GIVER, A: ASKER, B: GIVER2, C: ASKER2, X: UNVERIFIED } = USERS;
const { check, failures } = checker();

const WORLD = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to authenticated, anon, service_role;
  create table public.declutter_items (id uuid primary key default gen_random_uuid(), seller_id uuid, current_price_cents integer,
    status text, is_seed boolean default false, title text, porch_ok boolean not null default true, handovers text[],
    updated_at timestamptz);
  create table public.declutter_free_requests (id uuid primary key default gen_random_uuid(), item_id uuid, requester_id uuid,
    seller_id uuid, status text not null default 'open', created_at timestamptz not null default now(), closed_at timestamptz,
    pickup_at timestamptz);
  create table public.declutter_cart_items (id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid,
    seller_id uuid, price_cents integer, source text, offer_id uuid, checkout_by timestamptz,
    status text not null default 'in_cart', order_id uuid, closed_at timestamptz);
  create table public.declutter_orders (id uuid primary key default gen_random_uuid(), buyer_id uuid, seller_id uuid, handover text,
    items_cents integer, premium_cents integer, tax_cents integer, delivery_cents integer, total_cents integer,
    setup_fee_cents integer, card_fee_cents integer, paid_with text, status text not null default 'awaiting_payment',
    paid_at timestamptz);
  create unique index declutter_orders_one_awaiting on public.declutter_orders (buyer_id, seller_id) where status = 'awaiting_payment';
  create table public.declutter_bookings (order_id uuid primary key, buyer_id uuid, seller_id uuid, slot_start timestamptz,
    slot_end timestamptz);
  create table public.declutter_handovers (order_id uuid primary key, code text);
  create table public.declutter_offers (id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, status text,
    closed_at timestamptz, updated_at timestamptz, voided_by_line uuid);
  create table public.declutter_offer_events (offer_id uuid, actor_side text, action text);
  create table public.declutter_pickup_windows (id uuid primary key default gen_random_uuid(), seller_id uuid, weekday smallint,
    starts_local time, ends_local time);
  create table public.declutter_porch_places (id uuid primary key default gen_random_uuid(), seller_id uuid, position smallint,
    label text, address text, area text, lat numeric, lng numeric, weekdays smallint[], windows jsonb);
  create table public.declutter_porch_place_choices (buyer_id uuid, seller_id uuid, place_id uuid, primary key (buyer_id, seller_id));
  create table public.declutter_order_porch_places (order_id uuid primary key, seller_id uuid, place_id uuid, label text,
    address text, area text, lat numeric, lng numeric, weekdays smallint[], windows jsonb);
  create table public.declutter_seller_porch_days (seller_id uuid primary key, weekdays smallint[]);
  create table public.verified (user_id uuid primary key);
  create table public.user_roles (user_id uuid, role text);
  create table public.notices (user_id uuid, title text, body text);
  create function public.require_feature(text) returns void language sql as $f$ select $f$;
  create function public.is_caller_banned() returns boolean language sql stable as $f$ select false $f$;
  create function public.declutter_assert_member(boolean) returns uuid language sql as $f$ select auth.uid() $f$;
  create function public.are_users_blocked(uuid, uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.declutter_member_out(uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.seed_hidden_for(uuid) returns boolean language sql stable as $f$ select false $f$;
  -- has_role answers only about the caller (or for an admin caller): the giver asking about the picked person gets false.
  create function public.has_role(uuid, text) returns boolean language sql stable as $f$ select false $f$;
  create function public.identity_check_exempt(uuid) returns boolean language sql stable as $f$ select false $f$;
  create function public.is_identity_verified(p uuid) returns boolean language sql stable security definer as
    $f$ select exists (select 1 from public.verified v where v.user_id = p) $f$;
  create function public.declutter_new_handover_code() returns text language sql as $f$ select '1234' $f$;
  create function public.declutter_notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_actor uuid)
    returns void language sql security definer as $f$ insert into public.notices values (p_user, p_title, p_body) $f$;
`;
const OLD = ["declutter_is_porch_day", "declutter_order_is_porch_day", "declutter_order_porch_place_freeze_hours", "declutter_hold_length", "declutter_price_text", "declutter_slot_in_windows", "declutter_place_windows_valid",
  "declutter_place_windows_fill", "declutter_order_slot_in_windows", "declutter_take_item", "declutter_pick_free_request"]
  .map((n) => newestFunctionSql(n, VERSION).sql).join("\n");

const db = new PGlite();
await db.exec(WORLD + OLD + `
  create trigger declutter_order_porch_place_freeze_hours before insert on public.declutter_order_porch_places
    for each row execute function public.declutter_order_porch_place_freeze_hours();`);
for (let i = 0; i < (MUTANT ? 1 : 3); i++) await db.exec(FIX);
await db.exec(`grant execute on all functions in schema public to authenticated;`);
check(MUTANT ? "applies (mutant)" : "applies 3x (replay-safe)", true);

// Chicago wall-clock instants: in N days at HH:MM local.
const at = (days, hhmm) => `((date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '${days} days' + time '${hhmm}') AT TIME ZONE 'America/Chicago')`;
const dow = async (days) => (await db.query(`select extract(dow from (now() AT TIME ZONE 'America/Chicago') + interval '${days} day')::int d`)).rows[0].d;
const d1 = await dow(1);

// GIVER: no places, usual times every day 7 AM - 9 PM. GIVER2: two places; position 0 open only in 2 days 10-12,
// position 1 ("Shop") open tomorrow 1-5 PM.
await db.exec(`insert into public.verified values ('${ASKER}'), ('${ASKER2}');
  insert into public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  select s, d, '07:00', '21:00' from unnest(array['${GIVER}','${GIVER2}']::uuid[]) s, generate_series(0, 6) d;
  insert into public.declutter_porch_places (seller_id, position, label, address, area, lat, lng, weekdays, windows) values
   ('${GIVER2}', 0, 'Home', '1 Home St', 'Delcambre', 30, -92, array[${await dow(2)}]::smallint[],
    '[{"weekday": ${await dow(2)}, "starts": "10:00", "ends": "12:00"}]'::jsonb),
   ('${GIVER2}', 1, 'Shop', '9 Shop Rd', 'New Iberia', 30, -92, array[${d1}]::smallint[],
    '[{"weekday": ${d1}, "starts": "13:00", "ends": "17:00"}]'::jsonb);`);

const newItem = async (seller, title, extra = "") => (await db.query(`insert into public.declutter_items
  (seller_id, current_price_cents, status, title${extra ? ", " + extra.split("=")[0] : ""})
  values ('${seller}', 0, 'live', '${title}'${extra ? ", " + extra.split("=")[1] : ""}) returning id`)).rows[0].id;
const ask = async (item, seller, who, when) => (await db.query(`insert into public.declutter_free_requests
  (item_id, requester_id, seller_id, pickup_at) values ('${item}', '${who}', '${seller}', ${when ?? "null"}) returning id`)).rows[0].id;
const pick = (giver, req) => as(db, "authenticated", giver, `select public.declutter_pick_free_request('${req}') line`);
const orderFor = async (item) => (await db.query(`select o.status, o.handover, o.paid_with, o.total_cents, o.buyer_id,
  b.slot_start, b.slot_end - b.slot_start = interval '30 minutes' len, h.code, op.label place, i.status item_status, c.status line_status
  from public.declutter_cart_items c join public.declutter_items i on i.id = c.item_id
  left join public.declutter_orders o on o.id = c.order_id left join public.declutter_bookings b on b.order_id = o.id
  left join public.declutter_handovers h on h.order_id = o.id left join public.declutter_order_porch_places op on op.order_id = o.id
  where c.item_id = '${item}'`)).rows;
const noticesTo = async (u) => (await db.query(`select title, body from public.notices where user_id = '${u}'`)).rows;

// ── 1. A timed ask, giver with no places: the pick books that time ─────────────────
const strap = await newItem(GIVER, "Purse strap");
const r1 = await ask(strap, GIVER, ASKER, at(1, "15:00"));
const r2 = await ask(strap, GIVER, ASKER2, at(1, "16:00"));
let r = await pick(GIVER, r1);
check("the giver picks a timed ask", r.ok, r.err);
let o = await orderFor(strap);
check("a $0 free order, paid, for the picked person", o.length === 1 && o[0].status === "paid" && o[0].paid_with === "free"
  && o[0].total_cents === 0 && o[0].buyer_id === ASKER, JSON.stringify(o));
const same = (await db.query(`select b.slot_start = ${at(1, "15:00")} same from public.declutter_bookings b
  join public.declutter_cart_items c on c.order_id = b.order_id where c.item_id = '${strap}'`)).rows[0]?.same;
check("the pickup is booked at the asked time, 30 minutes", same === true && o[0].len === true, JSON.stringify(o));
check("a handover code exists (as declutter_book_pickup makes one)", o[0]?.code === "1234");
check("porch, the item's way", o[0]?.handover === "porch");
check("the item is sold and the line paid", o[0]?.item_status === "sold" && o[0]?.line_status === "paid", JSON.stringify(o));
let n = await noticesTo(ASKER);
check("the picked person gets ONE notice naming the time, no 48 hours", n.length === 1 && /Pickup is /.test(n[0].body)
  && !/48 hours/.test(n[0].body), JSON.stringify(n));
n = await noticesTo(ASKER2);
check("the other asker is told it went to someone else", n.length === 1 && n[0].title === "It went to someone else", JSON.stringify(n));
check("the giver gets no '48 hours' notice", (await noticesTo(GIVER)).every((x) => !/48 hours/.test(x.body)));

// ── 2. An ask with no time: the old 48-hour path ──────────────────────────────────
const lamp = await newItem(GIVER, "Lamp");
const r3 = await ask(lamp, GIVER, ASKER2, null);
r = await pick(GIVER, r3);
o = await orderFor(lamp);
check("no time: the item goes to their cart, no order, nothing booked", r.ok && o.length === 1 && o[0].status === null
  && o[0].line_status === "in_cart" && o[0].item_status === "reserved", r.err ?? JSON.stringify(o));
check("no time: the old 48-hour notice", (await noticesTo(ASKER2)).some((x) => /48 hours/.test(x.title)));

// ── 3. Times that can no longer be confirmed fall back ────────────────────────────
const vase = await newItem(GIVER, "Vase");
const r4 = await ask(vase, GIVER, ASKER, `now() - interval '1 hour'`);
r = await pick(GIVER, r4);
o = await orderFor(vase);
check("a time already past: the 48-hour path, nothing booked", r.ok && o[0]?.status === null && o[0]?.slot_start === null, r.err ?? JSON.stringify(o));
const rug = await newItem(GIVER, "Rug");
const r5 = await ask(rug, GIVER, ASKER, at(1, "22:30"));
r = await pick(GIVER, r5);
o = await orderFor(rug);
check("a time now outside the giver's hours: the 48-hour path", r.ok && o[0]?.status === null, r.err ?? JSON.stringify(o));
const hat = await newItem(GIVER, "Hat");
const r6 = await ask(hat, GIVER, UNVERIFIED, at(1, "15:00"));
r = await pick(GIVER, r6);
o = await orderFor(hat);
check("a picked person who still needs the ID check: the 48-hour path (they meet the check at their own checkout)",
  r.ok && o[0]?.status === null, r.err ?? JSON.stringify(o));
const ADMIN_ASKER = "00000000-0000-4000-8000-0000000000ad";
await db.exec(`insert into public.user_roles values ('${ADMIN_ASKER}', 'admin');`);
const pin = await newItem(GIVER, "Pin");
const r6b = await ask(pin, GIVER, ADMIN_ASKER, at(1, "15:00"));
r = await pick(GIVER, r6b);
o = await orderFor(pin);
check("an admin asker (no ID check needed) gets the asked time, read from user_roles, not the caller-scoped has_role",
  r.ok && o[0]?.status === "paid", r.err ?? JSON.stringify(o));
const cup = await newItem(GIVER, "Cup", "handovers=array['meetup']");
const r7 = await ask(cup, GIVER, ASKER2, at(1, "15:00"));
r = await pick(GIVER, r7);
o = await orderFor(cup);
check("an item with no pickup way: the 48-hour path", r.ok && o[0]?.status === null, r.err ?? JSON.stringify(o));
const box = await newItem(GIVER, "Box", "porch_ok=false");
const r8 = await ask(box, GIVER, ASKER2, at(1, "15:00"));
r = await pick(GIVER, r8);
o = await orderFor(box);
check("porch off: booked at the giver's home", r.ok && o[0]?.status === "paid" && o[0]?.handover === "pickup_home", r.err ?? JSON.stringify(o));

// ── 4. A giver with places: the place open at that time ───────────────────────────
const chair = await newItem(GIVER2, "Chair");
const r9 = await ask(chair, GIVER2, ASKER, at(1, "14:00"));
r = await pick(GIVER2, r9);
o = await orderFor(chair);
check("the place open at the asked time (Shop, not the first place)", r.ok && o[0]?.status === "paid" && o[0]?.place === "Shop", r.err ?? JSON.stringify(o));
const ok = (await db.query(`select public.declutter_order_slot_in_windows(o.id, o.seller_id, b.slot_start) ok
  from public.declutter_orders o join public.declutter_bookings b on b.order_id = o.id
  join public.declutter_cart_items c on c.order_id = o.id where c.item_id = '${chair}'`)).rows[0]?.ok;
check("the booked time is inside the order's own frozen hours (as declutter_book_pickup checks)", ok === true);
const desk = await newItem(GIVER2, "Desk");
const r10 = await ask(desk, GIVER2, ASKER, at(1, "09:00"));
r = await pick(GIVER2, r10);
o = await orderFor(desk);
check("no place open at that time (usual times would say yes): the 48-hour path", r.ok && o[0]?.status === null, r.err ?? JSON.stringify(o));

// ── 5. No places, porch days: porch only on one; another day is booked at the giver's home ──
await db.exec(`insert into public.declutter_seller_porch_days values ('${GIVER}', array[${(d1 + 3) % 7}]::smallint[])`);
const mat = await newItem(GIVER, "Mat");
const r12 = await ask(mat, GIVER, ASKER2, at(1, "15:00"));
r = await pick(GIVER, r12);
o = await orderFor(mat);
check("not a porch day: booked at the giver's home, still at the asked time", r.ok && o[0]?.status === "paid" && o[0]?.handover === "pickup_home", r.err ?? JSON.stringify(o));
const jar = await newItem(GIVER, "Jar", "handovers=array['porch']");
const r13 = await ask(jar, GIVER, ASKER2, at(1, "15:00"));
r = await pick(GIVER, r13);
o = await orderFor(jar);
check("porch-only item on a day that is not a porch day: the 48-hour path, nothing half-made", r.ok && o.length === 1
  && o[0]?.status === null && o[0]?.line_status === "in_cart", r.err ?? JSON.stringify(o));
const orphans = (await db.query(`select count(*) n from public.declutter_orders o where not exists
  (select 1 from public.declutter_cart_items c where c.order_id = o.id)`)).rows[0].n;
check("no order is left without its line", Number(orphans) === 0, `orphans ${orphans}`);

// ── 6. Guards unchanged ───────────────────────────────────────────────────────────
const fan = await newItem(GIVER, "Fan");
const r11 = await ask(fan, GIVER, ASKER, at(1, "15:00"));
r = await pick(GIVER2, r11);
check("only the giver can pick", refused(r, /request_not_found/), r.err ?? JSON.stringify(r.rows));
r = await pick(GIVER, r1);
check("a closed ask cannot be picked again", refused(r, /request_not_open|item_not_available/), r.err ?? JSON.stringify(r.rows));

await db.close();
if (failures()) process.exit(1);
console.log("ALL CHECKS PASSED");

#!/usr/bin/env node
/**
 * PGlite proof for *_free_asks_close_when_their_time_passes (A3-57, audit 7 11-01): a free ask whose pickup time passes
 * closes ('expired') with a notice to the asker and one to the giver per item; the giver is reminded about 2 hours
 * before the earliest open asked time (once per ask, never 8:50 PM-8 AM, never a test item, a moved time is reminded
 * again); the sweep rides sweep_deadline_reminders as its third half; and the giver can't pick an ask whose time passed
 * (no more 48-hour fallback for it).
 *
 *   node src/test/pglite/freeAskClosesWhenItsTimePasses.pglite.mjs                    # GREEN, migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/freeAskClosesWhenItsTimePasses.pglite.mjs # RED
 *   MUTANT=<name>[,<name>] node src/test/pglite/freeAskClosesWhenItsTimePasses.pglite.mjs  # each must FAIL
 *
 * World: freePickConfirmsTheTime.pglite.mjs's tables and stubs, plus declutter_notify_strict (records, or raises for a
 * member in fail_strict), log_cron_defect (records), stub book-by / needs-you sweeps (0). The NEWEST definitions before
 * the migration of the pick chain and needs_you_reminder_quiet are read from the migrations, never retyped.
 */
import { readdirSync } from "node:fs";
import { PGlite, readMigration, newestFunctionSql, as, checker, USERS } from "./seriesWorld.mjs";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const FILE = readdirSync(new URL("../../../supabase/migrations/", import.meta.url).pathname).find((f) => f.endsWith("_free_asks_close_when_their_time_passes.sql"));
if (!FILE) throw new Error("migration *_free_asks_close_when_their_time_passes.sql not found");
const VERSION = FILE.slice(0, 14);
let FIX = readMigration(FILE);
const MUTANTS = {
  // Asks are never closed.
  noclose: ["WHERE q.status = 'open' AND q.pickup_at IS NOT NULL AND q.pickup_at <= p_now\n", "WHERE false\n"],
  // An ask with no time (older builds) is closed too.
  nulltime: ["AND q.pickup_at IS NOT NULL AND q.pickup_at <= p_now\n", "AND COALESCE(q.pickup_at, p_now) <= p_now\n"],
  // The asker isn't told.
  noasker: ["PERFORM public.declutter_notify(r.requester_id, 'declutter_offers', 'Your pickup time passed',", "PERFORM 1 WHERE false AND public.declutter_notify(r.requester_id, 'declutter_offers', 'Your pickup time passed',"],
  // Test items are told.
  seedtold: ["       WHERE q.id = ANY (v_ids) AND COALESCE(i.is_seed, false) = false\n    LOOP", "       WHERE q.id = ANY (v_ids)\n    LOOP"],
  // No reminder dedupe: every run reminds again.
  nodedupe: ["       AND NOT EXISTS (SELECT 1 FROM public.declutter_free_requests q3\n                        WHERE q3.item_id = q.item_id AND q3.status = 'open' AND q3.giver_reminded_at IS NOT NULL)\n", ""],
  // Reminders in the quiet hours.
  quiet: ["  IF public.needs_you_reminder_quiet(p_now) THEN\n    RETURN v_done;", "  IF false THEN\n    RETURN v_done;"],
  // A reminder for any time, not only the next 2 hours.
  window: ["AND q.pickup_at <= p_now + interval '2 hours'", "AND q.pickup_at <= p_now + interval '9 days'"],
  // A moved time keeps the old reminder mark.
  moved: ["    NEW.giver_reminded_at := NULL;\n", ""],
  // A late pick still falls back to the 48-hour path.
  latepick: ["  IF v_req.pickup_at IS NOT NULL AND v_req.pickup_at <= now() THEN\n    RAISE EXCEPTION 'request_time_passed'", "  IF false THEN\n    RAISE EXCEPTION 'request_time_passed'"],
  // The cron wrapper doesn't run the new half.
  nowire: ["    v_free_asks := public.sweep_declutter_free_asks(p_now);", "    v_free_asks := 0;"],
  // The reminder goes through the forgiving notify: a failed notice is swallowed and the mark stays (never retried).
  strict: ["      PERFORM public.declutter_notify_strict(r.seller_id, 'declutter_offers', 'Pick who gets it',", "      PERFORM public.declutter_notify(r.seller_id, 'declutter_offers', 'Pick who gets it',"],
};
const MUTANT = process.env.MUTANT;
const SKIP = process.env.NEW_MIGRATION === "skip";
if (MUTANT) {
  for (const m of MUTANT.split(",")) {
    const [find, repl] = MUTANTS[m] ?? [];
    if (!find || !FIX.includes(find)) throw new Error(`mutant ${m}: text not found in the migration`);
    FIX = FIX.replace(find, repl);
  }
  console.log(`MUTANT=${MUTANT}: expect FAILs`);
}
if (SKIP) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { P: GIVER, A: ASKER, B: GIVER2, C: ASKER2 } = USERS;
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
  create table public.notices (user_id uuid, title text, body text, strict boolean default false);
  create table public.cron_defects_seen (fn text, ref text, msg text);
  create function public.log_cron_defect(p_fn text, p_ref text, p_msg text, p_ctx jsonb) returns void language sql
    as $f$ insert into public.cron_defects_seen values (p_fn, p_ref, p_msg) $f$;
  create table public.fail_strict (user_id uuid primary key);
  create function public.declutter_notify_strict(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_actor uuid)
    returns void language plpgsql security definer as $f$ begin
      if exists (select 1 from public.fail_strict f where f.user_id = p_user) then raise exception 'notify failed'; end if;
      insert into public.notices values (p_user, p_title, p_body, true); end $f$;
  create function public.declutter_book_by_reminder_sweep(timestamptz) returns integer language sql as $f$ select 0 $f$;
  create function public.sweep_needs_you_reminders(timestamptz) returns integer language sql as $f$ select 0 $f$;
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
  "declutter_place_windows_fill", "declutter_order_slot_in_windows", "declutter_take_item", "declutter_pick_free_request",
  "needs_you_reminder_quiet", "sweep_deadline_reminders"]
  .map((n) => newestFunctionSql(n, VERSION).sql).join("\n");

const db = new PGlite();
await db.exec(WORLD + OLD + `
  create trigger declutter_order_porch_place_freeze_hours before insert on public.declutter_order_porch_places
    for each row execute function public.declutter_order_porch_place_freeze_hours();`);
if (!SKIP) for (let i = 0; i < (MUTANT ? 1 : 3); i++) await db.exec(FIX);
await db.exec(`grant execute on all functions in schema public to authenticated;`);
check(SKIP ? "world without the migration" : MUTANT ? "applies (mutant)" : "applies 3x (replay-safe)", true);

const q1 = async (s) => (await db.query(s)).rows;
// Chicago wall clock: "noon" today, so the sweep's p_now is never in the quiet hours unless asked.
const T = (hhmm, days = 0) => `((date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '${days} days' + time '${hhmm}') AT TIME ZONE 'America/Chicago')`;
const sweep = async (when) => {
  try { return { ok: true, rows: await q1(`select public.sweep_deadline_reminders(${when}) r`) }; }
  catch (e) { return { ok: false, err: String(e.message) }; }
};
const newItem = async (seller, title, seed = false) => (await q1(`insert into public.declutter_items (seller_id, current_price_cents, status, title, is_seed)
  values ('${seller}', 0, 'live', '${title}', ${seed}) returning id`))[0].id;
const ask = async (item, seller, who, when) => (await q1(`insert into public.declutter_free_requests
  (item_id, requester_id, seller_id, pickup_at, created_at) values ('${item}', '${who}', '${seller}', ${when ?? "null"}, now() - interval '1 day') returning id`))[0].id;
const status = async (id) => (await q1(`select status, closed_at is not null closed from public.declutter_free_requests where id = '${id}'`))[0];
const notices = async (u) => q1(`select title, body, strict from public.notices where user_id = '${u}' order by ctid`);
const clear = () => db.exec(`delete from public.notices`);

// ── 1. CLOSE: an ask whose time passed, at the sweep ─────────────────────────────
const box = await newItem(GIVER, "Box of kids books");
const late1 = await ask(box, GIVER, ASKER, T("11:00"));
const late2 = await ask(box, GIVER, ASKER2, T("11:30"));
const later = await newItem(GIVER, "Lamp");
const fut = await ask(later, GIVER, ASKER, T("18:00"));
const old = await ask(later, GIVER, ASKER2, null);
let s = await sweep(T("12:00"));
check("the cron wrapper runs and reports the free_asks half", s.ok && s.rows[0]?.r?.free_asks === 2, s.err ?? JSON.stringify(s.rows));
check("both asks whose time passed are closed as expired", (await status(late1))?.status === "expired" && (await status(late2))?.status === "expired" && (await status(late1))?.closed);
check("an ask whose time is ahead stays open", (await status(fut))?.status === "open");
check("an ask with no time (older builds) is never closed here", (await status(old))?.status === "open");
let n = await notices(ASKER);
check("the asker is told their time passed and to ask again", n.length === 1 && n[0].title === "Your pickup time passed"
  && /didn't pick anyone for "Box of kids books" before your time\. Ask again with a new time/.test(n[0].body), JSON.stringify(n));
n = await notices(ASKER2);
check("the other asker is told too", n.length === 1 && n[0].title === "Your pickup time passed", JSON.stringify(n));
n = await notices(GIVER);
check("the giver gets ONE notice for the item, with the count", n.length === 1 && /^2 asks for "Box of kids books" ended/.test(n[0].body), JSON.stringify(n));
await clear();
s = await sweep(T("12:10"));
check("a second run closes nothing more and says nothing", s.ok && s.rows[0].r.free_asks === 0 && (await notices(ASKER)).length === 0 && (await notices(GIVER)).length === 0, JSON.stringify(s.rows));

// ── 2. Test items close silently ─────────────────────────────────────────────────
const seedItem = await newItem(GIVER2, "Seed chair", true);
const seedAsk = await ask(seedItem, GIVER2, ASKER2, T("12:05"));
await clear();
s = await sweep(T("12:20"));
check("a test item's ask closes", (await status(seedAsk))?.status === "expired");
check("a test item's ask closes with no notice to anyone", (await notices(ASKER2)).length === 0 && (await notices(GIVER2)).length === 0);

// ── 3. REMIND: about 2 hours before the earliest asked time ──────────────────────
const crib = await newItem(GIVER2, "Crib");
const c1 = await ask(crib, GIVER2, ASKER, T("15:00"));
const c2 = await ask(crib, GIVER2, ASKER2, T("16:00"));
await clear();
s = await sweep(T("12:30"));
check("no reminder 2.5 hours before", (await notices(GIVER2)).length === 0, JSON.stringify(await notices(GIVER2)));
s = await sweep(T("13:10"));
n = await notices(GIVER2);
check("a reminder 1 h 50 min before the earliest time, naming the count and the time", n.length === 1 && n[0].strict
  && n[0].title === "Pick who gets it" && n[0].body === '2 people asked for "Crib"; the first wants 3:00 PM. Next: pick someone by then.', JSON.stringify(n));
s = await sweep(T("13:20"));
check("never twice for the same time", (await notices(GIVER2)).length === 1, JSON.stringify(await notices(GIVER2)));
check("the askers get no reminder", (await notices(ASKER)).length === 0);
// The asker moves their time (declutter_request_free_at updates the same open ask): a new reminder for the new time.
await db.exec(`update public.declutter_free_requests set pickup_at = ${T("16:30")} where id = '${c1}'`);
await db.exec(`update public.declutter_free_requests set pickup_at = ${T("17:00")} where id = '${c2}'`);
await clear();
s = await sweep(T("14:40"));
n = await notices(GIVER2);
check("a moved time is reminded again", n.length === 1 && /the first wants 4:30 PM/.test(n[0].body), JSON.stringify(n));

// One asker: the singular words.
const desk = await newItem(GIVER, "Desk");
await ask(desk, GIVER, ASKER, T("14:00"));
await clear();
await sweep(T("12:30"));
n = (await notices(GIVER)).filter((x) => x.title === "Pick who gets it");
check("one asker: '1 person asked ... pick them by then'", n.length === 1 && n[0].body === '1 person asked for "Desk" and wants 2:00 PM. Next: pick them by then, or the ask ends.', JSON.stringify(n));

// Quiet hours: none 8:50 PM - 8 AM.
const rug = await newItem(GIVER, "Rug");
await ask(rug, GIVER, ASKER2, T("08:30", 1));
await clear();
await sweep(T("07:00", 1));
check("no reminder in the quiet hours (7 AM)", (await notices(GIVER)).filter((x) => /Rug/.test(x.body)).length === 0);
await sweep(T("08:00", 1));
check("the reminder goes at 8 AM", (await notices(GIVER)).filter((x) => /Rug/.test(x.body)).length === 1, JSON.stringify(await notices(GIVER)));

// Test item: no reminder.
const seed2 = await newItem(GIVER2, "Seed lamp", true);
await ask(seed2, GIVER2, ASKER, T("15:00", 2));
await clear();
await sweep(T("13:30", 2));
check("no reminder for a test item", (await notices(GIVER2)).length === 0, JSON.stringify(await notices(GIVER2)));

// A failed notice rolls back its mark (retried next run) and is recorded.
const mug = await newItem(GIVER2, "Mug");
const m1 = await ask(mug, GIVER2, ASKER, T("15:00", 3));
await db.exec(`insert into public.fail_strict values ('${GIVER2}')`);
await clear();
s = await sweep(T("13:30", 3));
const mark = (await q1(`select giver_reminded_at from public.declutter_free_requests where id = '${m1}'`))[0]?.giver_reminded_at;
check("a failed reminder keeps no mark and is recorded as a cron defect", s.ok && mark === null
  && (await q1(`select count(*)::int c from public.cron_defects_seen where fn = 'sweep_declutter_free_asks'`))[0].c === 1, JSON.stringify(s));
await db.exec(`delete from public.fail_strict`);
await sweep(T("13:40", 3));
check("the next run sends it", (await notices(GIVER2)).filter((x) => /Mug/.test(x.body)).length === 1);

// ── 4. PICK: an ask whose time passed can't be picked (no 48-hour fallback) ──────
const vase = await newItem(GIVER, "Vase");
const v1 = await ask(vase, GIVER, ASKER, `now() - interval '5 minutes'`);
let r = await as(db, "authenticated", GIVER, `select public.declutter_pick_free_request('${v1}') line`);
check("a pick after the asked time is refused with request_time_passed", !r.ok && /request_time_passed/.test(r.err), r.err ?? "picked");
const cart = await q1(`select count(*)::int c from public.declutter_cart_items where item_id = '${vase}'`);
check("nothing goes to their cart (no 48-hour path)", cart[0].c === 0);
check("the ask stays open for the sweep to close, the item stays up", (await status(v1))?.status === "open"
  && (await q1(`select status from public.declutter_items where id = '${vase}'`))[0].status === "live");
const v2 = await ask(vase, GIVER, ASKER2, null);
r = await as(db, "authenticated", GIVER, `select public.declutter_pick_free_request('${v2}') line`);
check("an ask with no time can still be picked (old path)", r.ok, r.err);

// ── 5. Grants ───────────────────────────────────────────────────────────────────
await db.exec(`revoke execute on all functions in schema public from authenticated;`);
if (!SKIP) await db.exec(FIX.split("\n").filter((l) => /^(REVOKE|GRANT) /.test(l)).join("\n"));
const g = await q1(`select has_function_privilege('authenticated', 'public.sweep_declutter_free_asks(timestamptz)', 'execute') a,
  has_function_privilege('anon', 'public.sweep_declutter_free_asks(timestamptz)', 'execute') b,
  has_function_privilege('service_role', 'public.sweep_declutter_free_asks(timestamptz)', 'execute') c`).catch(() => [{}]);
check("the sweep is service_role only", g[0].a === false && g[0].b === false && g[0].c === true, JSON.stringify(g));

// ── 6. On the fixed clock (Q1357): the sweep's own default now() closes an ask at its time, not a millisecond before ──
// Last, because it loads the newest committed definition over any mutant.
if (!SKIP) {
  await installClock(db);
  await db.exec(onFixedClock(newestFunction("sweep_declutter_free_asks").stmt));
  const clk = await newItem(GIVER, "Clock item");
  const k1 = await ask(clk, GIVER, ASKER, T("15:00", 5));
  const iso = (await q1(`select to_char(${T("15:00", 5)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') t`))[0].t;
  await setClock(db, new Date(Date.parse(iso) - 1).toISOString());
  await q1(`select public.sweep_declutter_free_asks()`);
  check("fixed clock: 1 ms before the asked time the ask stays open", (await status(k1))?.status === "open");
  await setClock(db, iso);
  await q1(`select public.sweep_declutter_free_asks()`);
  check("fixed clock: at the asked time the ask closes", (await status(k1))?.status === "expired");
} else check("fixed clock: the sweep exists", false);

const f = failures();
console.log(f ? `\n${f} FAIL` : "\nALL PASS");
process.exit(f ? 1 : 0);

#!/usr/bin/env node
/**
 * PGlite proof for 20261030061753_declutter_meetup_got_it_waits (Declutter audit 1030, buying DB-3): at a safe
 * meeting spot the buyer's "I got it" waits until a meeting time is booked and an hour before it (the hour
 * "I'm here" uses). Every other handover is unchanged.
 *
 *   node src/test/pglite/declutterMeetupGotItWaits.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterMeetupGotItWaits.pglite.mjs  # RED: prod's body
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterMeetupGotItWaits.pglite.mjs
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs (slices 1-4, seller delivery, Free, meetup, porch day), then the
 * two migrations that wrote prod's current declutter_confirm_handover (20261028202844, 20261030000030), once each,
 * so NEW_MIGRATION=skip runs PROD's body (md5 checked below). Then this migration 3 times. The booked meeting time
 * is moved by a direct write (setup only). pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261030061753_declutter_meetup_got_it_waits.sql";
const PROD_CHAIN = ["20261028202844_declutter_sd_confirm_waits_for_delivery_day.sql", "20261030000030_shipping_s2_ship_handover.sql"];
// md5(prosrc) of declutter_confirm_handover on prod (read-only SQL on fncmgoasalhdgfwzhsqa, 2026-10-30).
const PROD_MD5 = "b35a1002fb2959b2d9a8204bdb612ce4";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER, SELLER2, BUYER, BUYER2, BUYER3, ADMIN } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

for (const f of PROD_CHAIN) {
  const r = await run(readFileSync(`${MIG_DIR}${f}`, "utf8"));
  if (r?.error) throw new Error(`${f}: ${r.error}`);
}
const md5 = one(await svc(`SELECT md5(prosrc) FROM pg_proc WHERE proname = 'declutter_confirm_handover' AND pronamespace = 'public'::regnamespace`));
ok(md5 === PROD_MD5, `the world's declutter_confirm_handover is prod's body before this migration (md5 ${md5?.slice(0, 8)})`);

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `3d3d3d3d-0000-0000-0000-${String(n).padStart(12, "0")}`;
const status = async (id) => one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${id}'`));
const confirm = (uid, id) => me(uid, `SELECT public.declutter_confirm_handover('${id}', 'buyer', NULL) AS r`);
const accepted = async (r, id) => Array.isArray(r) && (await status(id)) === "handed_over";
/** Move the booked time (setup only: a direct write, as the safe-meetup proof does). */
const slotIn = (id, minutes) => svc(`UPDATE public.declutter_bookings SET slot_start = now() + interval '${minutes} minutes',
  slot_end = now() + interval '${minutes + 30} minutes' WHERE order_id = '${id}'`);
await svc(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT s, d, '00:00', '23:59' FROM unnest(ARRAY['${SELLER}', '${SELLER2}']::uuid[]) s, generate_series(0, 6) d ON CONFLICT DO NOTHING`);
const spot = one(await me(ADMIN, `SELECT public.admin_declutter_save_meetup_spot(NULL, 'East Baton Rouge', 'BRPD Safe Exchange',
  '9000 Airline Hwy, Baton Rouge, LA', 30.46, -91.14, 'police', 'Lit lot', true) AS id`));
async function paidOrder(n, buyer, seller, how) {
  await run(liveItemSql({ id: I(n), seller, title: `Got it item ${n}`, price: 2000, floor: 100 }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', 2000)`);
  if (how === "meetup") await me(buyer, `SELECT public.declutter_set_meetup_spot('${seller}', '${spot}')`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${seller}', '${how}')`))?.[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_db3_${n}', ${o?.total_cents}, now(), 150)`);
  return o?.order_id;
}

// 1. A meetup: no time booked, a day early, 61 minutes early: refused. Nothing is handed over.
const M = await paidOrder(1, BUYER, SELLER2, "meetup");
ok(!!M && (await status(M)) === "paid", "fixture: a paid meetup order");
const unbooked = await confirm(BUYER, M);
ok(refused(unbooked, /not_booked_yet/) && (await status(M)) === "paid", `no meeting time booked: "I got it" refused, not_booked_yet (${unbooked?.error ?? "accepted"})`);
const b = await me(BUYER, `SELECT public.declutter_book_pickup('${M}', now() + interval '1 day')`);
ok(Array.isArray(b), `fixture: the buyer books a meeting time${Array.isArray(b) ? "" : `: ${b?.error}`}`);
await slotIn(M, 26 * 60);
const dayEarly = await confirm(BUYER, M);
ok(refused(dayEarly, /got_it_too_early/) && (await status(M)) === "paid", `a day before the meeting: refused, got_it_too_early (${dayEarly?.error ?? "accepted"})`);
await slotIn(M, 61);
ok(refused(await confirm(BUYER, M), /got_it_too_early/) && (await status(M)) === "paid", "61 minutes before the meeting: still refused");
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_payouts WHERE order_id = '${M}'`)) === 0, "no payout clock started while refused");
// The seller can never confirm for the buyer (unchanged; the side check comes first).
ok(refused(await confirm(SELLER2, M), /wrong_side/), "the seller still cannot tap I got it (wrong_side)");

// 2. From an hour before (the hour "I'm here" opens): accepted.
await slotIn(M, 59);
const inHour = await confirm(BUYER, M);
ok(await accepted(inHour, M), `59 minutes before the meeting: "I got it" hands it over${Array.isArray(inHour) ? "" : `: ${inHour?.error}`}`);

// 3. After the meeting time: accepted.
const M2 = await paidOrder(2, BUYER2, SELLER2, "meetup");
await me(BUYER2, `SELECT public.declutter_book_pickup('${M2}', now() + interval '1 day')`);
await slotIn(M2, -10);
const after = await confirm(BUYER2, M2);
ok(await accepted(after, M2), `10 minutes after the meeting time: accepted${Array.isArray(after) ? "" : `: ${after?.error}`}`);

// 4. A door pickup (lead decision 2026-10-30: the same payout-clock risk; door orders book through the same
//    declutter_bookings rows): no time booked, a day early, 61 minutes early refused; 59 minutes before accepted.
const P = await paidOrder(3, BUYER3, SELLER, "pickup_home");
ok(!!P && (await status(P)) === "paid", "fixture: a paid door-pickup order");
const pUnbooked = await confirm(BUYER3, P);
ok(refused(pUnbooked, /not_booked_yet/) && (await status(P)) === "paid", `door pickup, no time booked: "I got it" refused, not_booked_yet (${pUnbooked?.error ?? "accepted"})`);
const pb = await me(BUYER3, `SELECT public.declutter_book_pickup('${P}', now() + interval '1 day')`);
ok(Array.isArray(pb), `fixture: the door buyer books a pickup time${Array.isArray(pb) ? "" : `: ${pb?.error}`}`);
await slotIn(P, 26 * 60);
const pDayEarly = await confirm(BUYER3, P);
ok(refused(pDayEarly, /got_it_too_early/) && (await status(P)) === "paid", `door pickup, a day before the pickup time: refused, got_it_too_early (${pDayEarly?.error ?? "accepted"})`);
await slotIn(P, 61);
ok(refused(await confirm(BUYER3, P), /got_it_too_early/) && (await status(P)) === "paid", "door pickup, 61 minutes before: still refused");
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_payouts WHERE order_id = '${P}'`)) === 0, "door pickup: no payout clock started while refused");
await slotIn(P, 59);
const pk = await confirm(BUYER3, P);
ok(await accepted(pk, P), `door pickup, 59 minutes before: "I got it" hands it over${Array.isArray(pk) ? "" : `: ${pk?.error}`}`);

// 5. Every other handover is unchanged: a porch pickup with no booking confirms at once, as on prod.
await run(liveItemSql({ id: I(4), seller: SELLER, title: "Got it item 4", price: 2000, floor: 100 }));
await svc(`UPDATE public.declutter_items SET porch_ok = true WHERE id = '${I(4)}'`);
await me(BUYER, `SELECT public.declutter_buy_now('${I(4)}', 2000)`);
const po = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'porch')`))?.[0];
await svc(`SELECT public.declutter_mark_order_paid('${po?.order_id}', 'pi_db3_4', ${po?.total_cents}, now(), 150)`);
const pr = await confirm(BUYER, po?.order_id);
ok(!!po?.order_id && await accepted(pr, po?.order_id), `a porch pickup: the buyer's "I got it" works as before${Array.isArray(pr) ? "" : `: ${pr?.error}`}`);

// 6. Grants (restated as prod has them).
ok(one(await svc(`SELECT has_function_privilege('anon', 'public.declutter_confirm_handover(uuid, text, text)', 'EXECUTE')`)) === false, "anon cannot run it");
ok(one(await svc(`SELECT has_function_privilege('authenticated', 'public.declutter_confirm_handover(uuid, text, text)', 'EXECUTE')`)) === true, "members can run it");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

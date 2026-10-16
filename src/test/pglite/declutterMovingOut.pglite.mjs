#!/usr/bin/env node
/**
 * PGlite proof for 20261016053625_declutter_moving_out (Declutter moving-out
 * mode, docs/specs/declutter-moving-out.md), on top of Declutter slices 1-4,
 * the $1,000 cap and F1, as prod holds them.
 *
 *   node src/test/pglite/declutterMovingOut.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterMovingOut.pglite.mjs    # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterMovingOut.pglite.mjs
 *
 * What it proves: the bulk path keeps every listing rule (switches, ban, 3
 * strikes, under 18, $1,000 cap, lowest price, area-not-an-address, contact
 * leak), is all-or-nothing, is capped, cannot publish (publish stays per item
 * and still needs photos), and the date RPC touches only the caller's items.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { setupStatements, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, SELLER2, OUTSIDER, MINOR, BANNED, STRUCK, NOPAYOUT } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";
const MOVING_FILE = "20261016053625_declutter_moving_out.sql";

const db = new PGlite();
const extra = [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 }];
if (!skip) extra.push(process.env.MIGRATION_PATH ? { path: process.env.MIGRATION_PATH, times: 3 } : { file: MOVING_FILE, times: 3 });
for (const sql of setupStatements({ times: 1, times3b: 1, extra })) await db.exec(sql);
await db.exec(`INSERT INTO public.declutter_strikes (user_id, offender_side, reason, given_at, expires_at)
  SELECT '${STRUCK}', 'buyer', 'missed_checkout', now(), now() + interval '1 year' FROM generate_series(1, 3)`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
async function me(uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const refused = (r, re) => !Array.isArray(r) && re.test(r.error);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const today = `(now() AT TIME ZONE 'America/Chicago')::date`;

const item = (o = {}) => ({
  title: "Oak dresser", description: "Six drawers.", category: "furniture", condition_stars: 4,
  delivery_size: "large", price_cents: 8000, floor_price_cents: 5000, ...o,
});
const lit = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
const create = (uid, items, { date = `${today} + 20`, area = "Mid-City, Baton Rouge", addr = "1234 Example St, Baton Rouge, LA 70806" } = {}) =>
  me(uid, `SELECT public.declutter_create_move_drafts(${date}, '${area}', '${addr}', 30.451234, -91.154321, ${lit(items)}) AS ids`);
const draftCount = async (uid) => Number(one(await svc(`SELECT count(*) FROM public.declutter_items WHERE seller_id = '${uid}' AND status = 'draft'`)));

// ---------------------------------------------------------------------------
// A. The switches (server-side, never only a hidden button).
ok(refused(await create(OUTSIDER, [item()]), /feature_disabled/), "a member the switches are off for is refused (feature_disabled)");
ok(refused(await me(OUTSIDER, `SELECT public.declutter_assert_can_scan_room()`), /feature_disabled/), "and cannot pass the room-scan gate");
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter_moving_out'`);
ok(refused(await create(SELLER, [item()]), /feature_disabled/), "with 'declutter' on but 'declutter_moving_out' off, a tester is refused");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter_moving_out'`);
ok(one(await svc(`SELECT audience FROM public.feature_switches WHERE key = 'declutter_moving_out'`)) === "testers",
  "the switch is created at 'testers' (never 'everyone')");

// ---------------------------------------------------------------------------
// B. Several drafts at once.
const made = await create(SELLER, [item(), item({ title: "Floor lamp", category: "home_decor", delivery_size: "small", price_cents: 1500, floor_price_cents: 1500 }), item({ title: "Box fan", description: null })]);
const ids = Array.isArray(made) ? made[0].ids : [];
ok(Array.isArray(ids) && ids.length === 3, "three drafts come back from one call");
const rows = Array.isArray(made) ? await svc(`SELECT i.status, i.move_out_on = ${today} + 20 AS dated, i.seller_id, p.pickup_address, p.floor_price_cents
  FROM public.declutter_items i JOIN public.declutter_item_private p ON p.item_id = i.id WHERE i.id = ANY('{${ids.join(",")}}'::uuid[])`) : [];
ok(Array.isArray(rows) && rows.length === 3 && rows.every((r) => r.status === "draft" && r.dated && r.seller_id === SELLER),
  "each is the seller's own DRAFT carrying the move-out date");
ok(Array.isArray(rows) && rows.every((r) => r.pickup_address.startsWith("1234 Example")), "each has its private pickup half (the one create path)");
ok(one(await svc(`SELECT area_lat FROM public.declutter_items WHERE id = '${ids[0]}'`)) === "30.45" || Number(one(await svc(`SELECT area_lat FROM public.declutter_items WHERE id = '${ids[0]}'`))) === 30.45,
  "the public coordinates are rounded like a single listing's");

// ---------------------------------------------------------------------------
// C. Every listing rule still applies, all or nothing.
const before = await draftCount(SELLER);
ok(refused(await create(SELLER, [item(), item({ price_cents: 100001, floor_price_cents: 100 })]), /price_cap|check constraint/i), "an item over $1,000 is refused (the table cap)");
ok(await draftCount(SELLER) === before, "... and the good item in the same call was NOT created (all or nothing)");
ok(refused(await create(SELLER, [item({ floor_price_cents: 9000 })]), /invalid_floor_price/), "a lowest price above the price is refused");
ok(refused(await create(SELLER, [item({ floor_price_cents: 50 })]), /invalid_floor_price/), "a lowest price under $1 is refused");
ok(refused(await create(SELLER, [item()], { area: "1234 Example St" }), /area_looks_like_address/), "an area that is a street address is refused");
ok(refused(await create(SELLER, [item({ title: "Call me 225-555-0199" })]), /contact|check_violation|Keep contact/i), "a phone number in a title is refused (contact-leak trigger)");
ok(refused(await create(MINOR, [item()]), /under_18/), "an under-18 seller is refused");
ok(refused(await create(BANNED, [item()]), /account_restricted/), "a banned seller is refused");
ok(refused(await create(STRUCK, [item()]), /declutter_strikes_blocked/), "a seller with 3 strikes is refused");
ok(refused(await me(MINOR, `SELECT public.declutter_assert_can_scan_room()`), /under_18/), "the room-scan gate refuses an under-18 seller");
ok(refused(await me(STRUCK, `SELECT public.declutter_assert_can_scan_room()`), /declutter_strikes_blocked/), "and a seller with 3 strikes");
ok(refused(await me(BANNED, `SELECT public.declutter_assert_can_scan_room()`), /account_restricted/), "and a banned one");
ok(Array.isArray(await me(SELLER, `SELECT public.declutter_assert_can_scan_room()`)), "and lets a tester who may sell through");

// ---------------------------------------------------------------------------
// D. Shapes, sizes, dates.
ok(refused(await create(SELLER, []), /too_many_items/), "zero items is refused");
ok(refused(await create(SELLER, Array.from({ length: 16 }, () => item())), /too_many_items/), "16 items in one call is refused");
ok(refused(await create(SELLER, [item({ price_cents: "8000" })]), /invalid_items/), "a price sent as text is refused as a bad shape");
ok(refused(await create(SELLER, [item({ condition_stars: 4.5 })]), /invalid_items/), "a fractional star count is refused as a bad shape");
ok(refused(await create(SELLER, [{ title: "No price" }]), /invalid_items/), "an item missing fields is refused");
ok(refused(await me(SELLER, `SELECT public.declutter_create_move_drafts(${today} + 20, 'Mid-City', '1 A St', 30.4, -91.1, '{"a":1}'::jsonb)`), /invalid_items/), "an object instead of a list is refused");
ok(refused(await create(SELLER, [item()], { date: `${today} - 1` }), /invalid_move_out_date/), "a move-out date in the past is refused");
ok(refused(await create(SELLER, [item()], { date: `${today} + 181` }), /invalid_move_out_date/), "a date more than 180 days out is refused");
ok(refused(await create(SELLER, [item()], { date: "NULL::date" }), /invalid_move_out_date/), "a NULL date is refused");
ok(Array.isArray(await create(SELLER2, [item()], { date: today })), "today is accepted");

// ---------------------------------------------------------------------------
// E. The draft cap: 60 unfinished moving-sale drafts.
for (let k = 0; k < 3; k++) await create(SELLER2, Array.from({ length: 15 }, (_, j) => item({ title: `Box ${k}-${j}` })));
ok(await draftCount(SELLER2) === 46, "setup: 46 moving-sale drafts for SELLER2");
ok(Array.isArray(await create(SELLER2, Array.from({ length: 14 }, () => item()))), "up to 60 is allowed");
ok(refused(await create(SELLER2, [item()]), /move_draft_limit/), "a 61st unfinished draft is refused");

// ---------------------------------------------------------------------------
// F. No bulk publish: the per-item publish still needs photos, attestations, payouts.
ok(refused(await me(SELLER, `SELECT public.declutter_publish_item('${ids[0]}')`), /photos_required|attestation_required|pickup_windows_required/),
  "a moving-sale draft publishes only through declutter_publish_item, with its own checks");
ok(one(await svc(`SELECT count(*) FROM pg_proc WHERE proname ~ '^declutter_.*publish' AND pronamespace = 'public'::regnamespace`)) == 1,
  "there is exactly one publish function (no bulk publish on the server)");

// ---------------------------------------------------------------------------
// G. Moving the date / ending the moving sale.
await svc(`INSERT INTO public.declutter_items (seller_id, status, title, category, condition_stars, delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng)
  VALUES ('${SELLER}', 'draft', 'Ordinary listing', 'other', 3, 'small', 500, 500, 'Mid-City', 30.45, -91.15)`);
const moved = await me(SELLER, `SELECT public.declutter_set_move_out_date(${today} + 30) AS n`);
ok(one(moved) === 3, "moving the date changes the seller's 3 moving-sale items");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_items WHERE seller_id = '${SELLER}' AND move_out_on = ${today} + 30`))) === 3, "they carry the new date");
ok(one(await svc(`SELECT move_out_on FROM public.declutter_items WHERE title = 'Ordinary listing'`)) === null, "an ordinary listing is never pulled into the moving sale");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_items WHERE seller_id = '${SELLER2}' AND move_out_on = ${today} + 30`))) === 0, "another seller's items are untouched");
ok(refused(await me(SELLER, `SELECT public.declutter_set_move_out_date(${today} - 3)`), /invalid_move_out_date/), "a past date is refused");
ok(refused(await me(OUTSIDER, `SELECT public.declutter_set_move_out_date(NULL)`), /feature_disabled/), "the date RPC is behind the switches too");
ok(refused(await me(BANNED, `SELECT public.declutter_set_move_out_date(NULL)`), /account_restricted/), "and refuses a banned member");
await svc(`UPDATE public.declutter_items SET status = 'sold' WHERE id = '${ids[2]}'`);
ok(one(await me(SELLER, `SELECT public.declutter_set_move_out_date(NULL) AS n`)) === 2, "ending the moving sale clears the 2 items still in play");
ok(one(await svc(`SELECT move_out_on IS NOT NULL FROM public.declutter_items WHERE id = '${ids[2]}'`)) === true, "a sold item keeps the date it sold under");
ok(one(await me(SELLER, `SELECT public.declutter_set_move_out_date(${today} + 5) AS n`)) === 0, "after it ends, a new date changes nothing (0 rows, not an error)");

// ---------------------------------------------------------------------------
// H. Who may execute what (prod's default ACL grants anon EXECUTE on every new function).
for (const sig of [
  "public.declutter_create_move_drafts(date, text, text, numeric, numeric, jsonb)",
  "public.declutter_set_move_out_date(date)",
  "public.declutter_assert_can_scan_room()",
]) {
  ok(one(await svc(`SELECT has_function_privilege('anon', '${sig}', 'EXECUTE')`)) === false, `anon cannot execute ${sig}`);
  ok(one(await svc(`SELECT has_function_privilege('authenticated', '${sig}', 'EXECUTE')`)) === true, `authenticated can execute ${sig}`);
}
ok(one(await svc(`SELECT has_function_privilege('authenticated', 'public.declutter_move_out_date_problem(date)', 'EXECUTE')`)) === false,
  "the date helper is internal (authenticated cannot call it)");
ok(refused(await me(SELLER, `UPDATE public.declutter_items SET move_out_on = ${today} + 2 WHERE seller_id = '${SELLER}' RETURNING id`), /permission denied|violates/i)
  || Number(one(await svc(`SELECT count(*) FROM public.declutter_items WHERE seller_id = '${SELLER}' AND move_out_on = ${today} + 2`))) === 0,
  "a seller cannot write the date directly (no client write on declutter_items)");
// NOPAYOUT may still make drafts (row 23 gates publishing, not writing).
ok(Array.isArray(await create(NOPAYOUT, [item()])), "a seller without payouts may still save drafts (payouts gate the listing, as for one item)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

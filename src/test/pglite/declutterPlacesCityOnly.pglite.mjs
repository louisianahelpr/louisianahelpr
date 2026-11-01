#!/usr/bin/env node
/**
 * PGlite proof for 20261101054401_declutter_places_city_only_for_buyers (owner 2026-10-31 11:42 PM, "Pickup places
 * show the CITY only, never the place's label"): no read a buyer can call returns a place's label; the seller
 * still sees their own; the address still opens only after payment.
 *
 *   node src/test/pglite/declutterPlacesCityOnly.pglite.mjs                    # GREEN (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPlacesCityOnly.pglite.mjs # RED: the chain without it
 *   MIGRATION_PATH=<planted copy> node ...                                     # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, the porch-places and place-hours chain (the newest CREATE of
 * declutter_item_pickup_places and declutter_seller_porch_places, 20261031145652), plus declutter_held_address_closed
 * from 20261031004529 (declutter_order_place's newest CREATE reads it). Places are saved through the real RPC.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261101054401_declutter_places_city_only_for_buyers.sql";
const BASES = [
  "20261027211754_declutter_bundle_discount.sql",
  "20261028195840_declutter_pickup_window_reads.sql",
  "20261028200440_declutter_audit3_notices_and_empty_cart.sql",
  "20261028235247_declutter_handover_choices.sql",
  "20261028235709_declutter_handover_photos_at_the_address.sql",
  "20261029002010_declutter_handover_photos_live_only.sql",
  "20261029161347_declutter_porch_weekdays.sql",
  "20261029201542_declutter_porch_photo_not_before_the_day.sql",
  "20261030164712_declutter_porch_places.sql",
  "20261031145652_declutter_place_hours.sql",
];
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER2, BUYER } = USERS;

let pass = 0;
let fail = 0;
let guarded = 0;
const ok = (cond, label, expectRedWithoutFix = false) => {
  if (cond) pass++; else fail++;
  if (expectRedWithoutFix) guarded++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};
const short = (r) => JSON.stringify(r)?.slice(0, 220);
const LABELS = ["Mom's house", "Camp"];
const namesALabel = (rows) => !Array.isArray(rows) || rows.some((r) => LABELS.includes(r.label) || LABELS.some((l) => JSON.stringify(r).includes(l)));

await svc(`ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS seller_hidden boolean NOT NULL DEFAULT false`);
for (const f of BASES) {
  const r = await run(readFileSync(`${MIG_DIR}${f}`, "utf8"));
  ok(!r?.error, `base ${f} applies${r?.error ? `: ${r.error}` : ""}`);
}
// declutter_order_place's newest CREATE (20261031004529) reads this helper. Its handover columns are prod's
// (types.ts declutter_handovers: seller_confirmed_at, set_out_at, no_show_reported_at, timestamptz), which this
// world's older handover table lacks.
await svc(`ALTER TABLE public.declutter_handovers ADD COLUMN IF NOT EXISTS seller_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS set_out_at timestamptz, ADD COLUMN IF NOT EXISTS no_show_reported_at timestamptz`);
{
  const t = readFileSync(`${MIG_DIR}20261031004529_declutter_handover_both_confirm.sql`, "utf8");
  const start = t.indexOf("CREATE OR REPLACE FUNCTION public.declutter_held_address_closed(");
  const end = t.indexOf("$function$;", t.indexOf("$function$", start) + 10) + "$function$;".length;
  const r = await run(t.slice(start, end));
  ok(!r?.error, `declutter_held_address_closed (20261031004529) applies${r?.error ? `: ${r.error}` : ""}`);
}

const save = (label, addr, p, windows) => me(SELLER2,
  `SELECT public.declutter_save_porch_place(NULL, '${label.replace(/'/g, "''")}', '${addr}', 'New Iberia', ${p.lat}, ${p.lng}, NULL, '${JSON.stringify(windows)}'::jsonb) AS id`);
const home = one(await save("Mom's house", "12 Home Street, New Iberia", { lat: 30.2, lng: -92.0 }, [{ weekday: 1, starts: "09:00", ends: "17:00" }]));
const camp = one(await save("Camp", "99 Camp Road, New Iberia", { lat: 29.95, lng: -90.07 }, [{ weekday: 6, starts: "09:00", ends: "12:00" }]));
ok(typeof home === "string" && typeof camp === "string", "fixture: the seller saves two labelled places");

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = "dddddddd-0000-0000-0000-000000000101";
await run(liveItemSql({ id: I, seller: SELLER2, title: "City only item", price: 1500, floor: 100 }));

// C1 the item page, as a buyer: both places, the city and the hours, no label.
const itemBuyer = await me(BUYER, `SELECT * FROM public.declutter_item_pickup_places('${I}')`);
ok(Array.isArray(itemBuyer) && itemBuyer.length === 2 && itemBuyer.every((r) => r.label === null && r.area === "New Iberia") && !namesALabel(itemBuyer),
  `C1 item page (buyer): the city only, never the label (${short(itemBuyer)})`, true);

// C2 the item page, as its seller: their own labels.
const itemSeller = await me(SELLER2, `SELECT label FROM public.declutter_item_pickup_places('${I}')`);
ok(Array.isArray(itemSeller) && itemSeller.map((r) => r.label).join("|") === "Mom's house|Camp", `C2 item page (seller): their own labels (${short(itemSeller)})`);

// C3 the buyer's place picker in the cart: ids to choose by, the city and days, no label.
await me(BUYER, `SELECT public.declutter_buy_now('${I}', 1500)`);
const picker = await me(BUYER, `SELECT * FROM public.declutter_seller_porch_places('${SELLER2}')`);
ok(Array.isArray(picker) && picker.length === 2 && picker.every((r) => r.label === null && r.area === "New Iberia" && typeof r.id === "string") && !namesALabel(picker),
  `C3 cart picker (buyer): the city only (${short(picker)})`, true);

// C4 the order's frozen place: before paying, no label and no address; after paying, the address but still no label.
await me(BUYER, `SELECT public.declutter_set_porch_place('${SELLER2}', '${camp}')`);
const P = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'porch')`))?.[0];
ok(!!P?.order_id, `fixture: porch checkout at Camp opens an order${P?.order_id ? "" : ` (got ${short(P)})`}`);
const unpaid = await me(BUYER, `SELECT * FROM public.declutter_order_place('${P?.order_id}')`);
ok(Array.isArray(unpaid) && unpaid.length === 1 && unpaid[0].label === null && unpaid[0].address === null && unpaid[0].area === "New Iberia",
  `C4a order place before paying (buyer): the city only, no label, no address (${short(unpaid)})`, true);
await svc(`SELECT public.declutter_mark_order_paid('${P?.order_id}', 'pi_city_only_1', ${P?.total_cents}, now(), 150)`);
const paid = await me(BUYER, `SELECT * FROM public.declutter_order_place('${P?.order_id}')`);
ok(Array.isArray(paid) && paid[0]?.label === null && paid[0]?.address === "99 Camp Road, New Iberia",
  `C4b order place after paying (buyer): the address, still no label (${short(paid)})`, true);
const sellerSide = await me(SELLER2, `SELECT * FROM public.declutter_order_place('${P?.order_id}')`);
ok(Array.isArray(sellerSide) && sellerSide[0]?.label === "Camp" && sellerSide[0]?.address === "99 Camp Road, New Iberia",
  `C4c order place (seller): their label and address (${short(sellerSide)})`);

// C5 guests: none of the three is callable by anon.
const acl = async (fn) => one(await svc(`SELECT has_function_privilege('anon', 'public.${fn}', 'EXECUTE')`));
ok(await acl("declutter_item_pickup_places(uuid)") === false && await acl("declutter_seller_porch_places(uuid)") === false
   && await acl("declutter_order_place(uuid)") === false, "C5 anon cannot call any of the three");

const expectRed = guarded;
console.log(`\n${pass} passed, ${fail} failed`);
if (skip) {
  // Without the fix every guarded check (C1, C3, C4a, C4b) is red and the rest are green.
  console.log(fail === expectRed ? `RED as expected (${fail}/${expectRed})` : `NOT the expected red: ${fail} failed, ${expectRed} guarded`);
  process.exit(fail === expectRed ? 0 : 1);
}
process.exit(fail > 0 ? 1 : 0);

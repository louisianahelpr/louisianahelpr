#!/usr/bin/env node
/**
 * PGlite proof for 20261030153203_shipping_s3_listing_options.sql (docs/specs/shipping-draft.md section 6; owner decisions 8, 9, 11; Q2259): the
 * seller's "Ship it" parcel preset and "I'll pay shipping" flag on a listing. Only the seller, only small priced
 * listings, only with the declutter_shipping switch on (an ordinary account is refused), never by a direct write;
 * an edit to a non-small size or a $0 price clears both in the same update.
 *
 *   node src/test/pglite/shippingS3ListingOptions.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/shippingS3ListingOptions.pglite.mjs  # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shippingS3ListingOptions.pglite.mjs
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261030153203_shipping_s3_listing_options.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER, SELLER2, BUYER } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

await run(`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email text`);
for (const f of ["20261012031120_hidden_feature_switches.sql", "20261028151647_feature_switch_members.sql",
  "20261030000030_shipping_s2_ship_handover.sql", "20261030012052_shipping_s2_postage_rates.sql"]) {
  const r = await run(readFileSync(`${MIG_DIR}${f}`, "utf8"));
  if (r?.error) { console.log(`world: ${f} failed: ${r.error}`); process.exit(2); }
}
await run(`INSERT INTO public.feature_switches (key, audience, description) VALUES ('declutter', 'testers', 'x') ON CONFLICT (key) DO NOTHING`);

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `5a5a5a5a-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SMALL = I(1), LARGE = I(2), OTHER = I(3), FREE = I(4);
await run(liveItemSql({ id: SMALL, seller: SELLER, title: "Mug", price: 1500, floor: 500 }));
await run(liveItemSql({ id: LARGE, seller: SELLER, title: "Chair", price: 4000, floor: 2000 }));
await run(liveItemSql({ id: OTHER, seller: SELLER2, title: "Lamp", price: 1200, floor: 500 }));
await run(liveItemSql({ id: FREE, seller: SELLER, title: "Book", price: 1000, floor: 100 }));
await run(`UPDATE public.declutter_items SET delivery_size = 'small' WHERE id IN ('${SMALL}', '${OTHER}', '${FREE}')`);
await run(`UPDATE public.declutter_items SET price_cents = 0, current_price_cents = 0 WHERE id = '${FREE}'`);
await run(`UPDATE public.declutter_item_private SET floor_price_cents = 0 WHERE item_id = '${FREE}'`);

const set = (uid, item, preset, pays) =>
  me(uid, `SELECT public.declutter_set_ship_options('${item}', ${preset === null ? "NULL" : `'${preset}'`}, ${pays}) AS r`);
const state = async (item) => one(await svc(`SELECT ship_preset || ':' || seller_pays_shipping FROM public.declutter_items WHERE id = '${item}'`))
  ?? one(await svc(`SELECT 'null:' || seller_pays_shipping FROM public.declutter_items WHERE id = '${item}'`));

// The switch: SELLER2 is made an ordinary account (the world enrols every fixture user as a test account).
await run(`DELETE FROM public.test_accounts WHERE user_id = '${SELLER2}'`);
ok(refused(await set(SELLER2, OTHER, "small_box", false), /feature_disabled/), "an ordinary account is refused (feature_disabled)");
ok(refused(await me(SELLER2, `SELECT public.declutter_ship_options_state('${OTHER}')`), /feature_disabled/),
  "an ordinary account cannot read the options either");

// The seller, a small priced listing.
const r1 = await set(SELLER, SMALL, "small_box", false);
ok(Array.isArray(r1), `the seller turns on shipping with a parcel preset${Array.isArray(r1) ? "" : `: ${r1?.error}`}`);
ok((await state(SMALL)) === "small_box:false", `stored: ${await state(SMALL)}`);
ok(Array.isArray(await set(SELLER, SMALL, "envelope", true)), "the seller ticks I'll pay shipping");
ok((await state(SMALL)) === "envelope:true", `stored: ${await state(SMALL)}`);
const st = await me(SELLER, `SELECT public.declutter_ship_options_state('${SMALL}') AS s`);
ok(Array.isArray(st) && st[0].s.preset === "envelope" && st[0].s.seller_pays === true, "the seller reads their options back");

// Refusals.
ok(refused(await set(SELLER, LARGE, "small_box", false), /ship_small_only/), "a large listing cannot ship (small only)");
ok(refused(await set(SELLER, FREE, "small_box", false), /ship_not_free_items/), "a free listing cannot ship");
ok(refused(await set(SELLER, SMALL, null, true), /invalid_choice/), "I'll pay shipping without shipping is refused");
ok(refused(await set(SELLER, SMALL, "crate", false), /invalid_choice/), "an unknown preset is refused");
ok(refused(await set(BUYER, SMALL, "small_box", false), /item_not_found/), "someone else's listing is refused (not found)");
ok(refused(await me(BUYER, `SELECT public.declutter_ship_options_state('${SMALL}')`), /item_not_found/), "someone else cannot read the options");
ok(refused(await me(null, `SELECT public.declutter_set_ship_options('${SMALL}', 'small_box', false)`), /permission denied/), "anon cannot call it");
ok(refused(await me(SELLER, `UPDATE public.declutter_items SET ship_preset = 'large_box' WHERE id = '${SMALL}'`), /permission denied/),
  "the seller cannot write the preset directly");
ok(refused(await svc(`UPDATE public.declutter_items SET ship_preset = NULL WHERE id = '${SMALL}'`), /declutter_items_seller_pays_needs_preset/),
  "seller-paid can never stand without a preset (CHECK)");

// Off clears both.
ok(Array.isArray(await set(SELLER, SMALL, null, false)), "the seller turns shipping off");
ok((await state(SMALL)) === "null:false", `cleared: ${await state(SMALL)}`);

// Shipping follows the listing: a size edit or a $0 price clears it in the same update.
await set(SELLER, SMALL, "medium_box", true);
const sz = await svc(`UPDATE public.declutter_items SET delivery_size = 'large' WHERE id = '${SMALL}' RETURNING ship_preset, seller_pays_shipping`);
ok(Array.isArray(sz) && sz[0].ship_preset === null && sz[0].seller_pays_shipping === false,
  `an edit to a large size clears shipping instead of failing${Array.isArray(sz) ? "" : `: ${sz?.error}`}`);
await run(`UPDATE public.declutter_items SET delivery_size = 'small' WHERE id = '${SMALL}'`);
await set(SELLER, SMALL, "small_box", true);
const pz = await svc(`UPDATE public.declutter_items SET price_cents = 0, current_price_cents = 0 WHERE id = '${SMALL}' RETURNING ship_preset, seller_pays_shipping`);
ok(Array.isArray(pz) && pz[0].ship_preset === null && pz[0].seller_pays_shipping === false,
  `a listing made free clears shipping${Array.isArray(pz) ? "" : `: ${pz?.error}`}`);

for (const fn of ["declutter_set_ship_options(uuid, text, boolean)", "declutter_ship_options_state(uuid)"]) {
  const acl = one(await svc(`SELECT proacl::text FROM pg_proc WHERE oid = 'public.${fn}'::regprocedure`)) ?? "";
  ok(!/(^|[{,])=X|anon=X/.test(acl) && /authenticated=X/.test(acl), `${fn}: members only, not PUBLIC or anon (${acl})`);
}

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip: RED baseline)" : ""}`);
if (fail) process.exit(1);

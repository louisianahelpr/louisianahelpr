#!/usr/bin/env node
/**
 * PGlite proof for 20261030012052_shipping_s2_postage_rates (docs/specs/shipping-draft.md S2 rates; owner decisions 11
 * and 13; Q2259): shipping_quotes is service-role only, Louisiana-only, parcel-capped, 30-minute, frozen once stored,
 * and stored only for a buyer the declutter_shipping switch is on for (an ordinary account is refused); the switch
 * is created for testers; UPS Ground joins the label services and nothing else does.
 *
 *   node src/test/pglite/shippingS2Quotes.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/shippingS2Quotes.pglite.mjs  # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/shippingS2Quotes.pglite.mjs
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, the hidden-switch infrastructure (20261012031120,
 * 20261028151647), the S2 database part (20261030000030), then this migration 3 times.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261030012052_shipping_s2_postage_rates.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER, BUYER, BUYER2, ADMIN } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

await run(`ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email text`); // the members migration enrols by e-mail
for (const f of ["20261012031120_hidden_feature_switches.sql", "20261028151647_feature_switch_members.sql",
  "20261030000030_shipping_s2_ship_handover.sql"]) {
  const r = await run(readFileSync(`${MIG_DIR}${f}`, "utf8"));
  if (r?.error) { console.log(`world: ${f} failed: ${r.error}`); process.exit(2); }
}

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

// BUYER2 is a tester (test_accounts); BUYER is an ordinary account (the world enrols every fixture user as a test
// account, so BUYER is taken out of it here).
await run(`INSERT INTO public.test_accounts (user_id) VALUES ('${BUYER2}') ON CONFLICT DO NOTHING`);
await run(`DELETE FROM public.test_accounts WHERE user_id = '${BUYER}'`);
ok(one(await svc(`SELECT count(*) FROM public.test_accounts WHERE user_id = '${BUYER}'`)) === 0
  && one(await svc(`SELECT count(*) FROM public.user_roles WHERE user_id = '${BUYER}'`)) === 0, "BUYER is an ordinary account (not a test account, no role)");

ok(one(await svc(`SELECT audience FROM public.feature_switches WHERE key = 'declutter_shipping'`)) === "testers",
  "the declutter_shipping switch exists, for testers only");

const SHIP_TO = `'{"zip":"70112","street1":"1 Main St","city":"New Orleans","state":"LA"}'::jsonb`;
const PARCEL = `'{"weight_oz":12,"length_in":9,"width_in":6,"height_in":3}'::jsonb`;
const quote = (buyer, over = {}) => {
  const v = {
    buyer_id: `'${buyer}'`, seller_id: `'${SELLER}'`, cart_item_ids: `ARRAY[gen_random_uuid()]`, label_mode: `'test'`,
    service: `'usps_ground_advantage'`, rate_cents: "650", provider_rate_id: `'rate_abc123'`,
    provider_shipment_id: `'shp_def456'`, ship_to: SHIP_TO, parcel: PARCEL, ...over,
  };
  return `INSERT INTO public.shipping_quotes (${Object.keys(v).join(", ")}) VALUES (${Object.values(v).join(", ")}) RETURNING id`;
};

// The switch is the server-side gate (an ordinary account is refused even through the service role).
ok(refused(await svc(quote(BUYER)), /feature_disabled/), "an ordinary account's quote is refused (feature_disabled)");
const q1 = await svc(quote(BUYER2));
ok(Array.isArray(q1) && q1.length === 1, `a tester's quote is stored${Array.isArray(q1) ? "" : `: ${q1?.error}`}`);
const q1id = Array.isArray(q1) ? q1[0].id : null;
await run(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin') ON CONFLICT DO NOTHING`);
ok(Array.isArray(await svc(quote(ADMIN))), "an admin's quote is stored (testers = admins + test accounts)");

// Allowed services: exactly the owner's three (decision 13).
ok(Array.isArray(await svc(quote(BUYER2, { service: `'ups_ground'`, rate_cents: "760", provider_rate_id: `'rate_ups1'` }))),
  "UPS Ground is an allowed quote service");
for (const bad of ["usps_express", "ups_next_day_air", "fedex_overnight", "ups_2nd_day_air"]) {
  ok(refused(await svc(quote(BUYER2, { service: `'${bad}'` })), /shipping_quotes_service_check|check constraint/),
    `${bad} is refused as a quote service`);
}
const shipCheck = one(await svc(`SELECT pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conrelid = 'public.shipments'::regclass AND conname = 'shipments_service_check'`)) ?? "";
ok(/ups_ground/.test(shipCheck) && /usps_ground_advantage/.test(shipCheck) && /usps_priority/.test(shipCheck)
  && !/air|express|overnight/i.test(shipCheck), `shipments.service allows exactly USPS GA, USPS Priority, UPS Ground (${shipCheck})`);

// Louisiana only, parcel caps, sane ids and amounts.
for (const [label, over, re] of [
  ["a Texas ZIP", { ship_to: `'{"zip":"75001"}'::jsonb` }, /check constraint/],
  ["a missing ZIP", { ship_to: `'{"street1":"1 Main St"}'::jsonb` }, /check constraint/],
  ["a 21 lb parcel", { parcel: `'{"weight_oz":336,"length_in":9}'::jsonb` }, /check constraint/],
  ["a 23 in side", { parcel: `'{"weight_oz":12,"length_in":23}'::jsonb` }, /check constraint/],
  ["a parcel with no weight", { parcel: `'{"length_in":9}'::jsonb` }, /check constraint/],
  ["a zero rate", { rate_cents: "0" }, /check constraint/],
  ["a rate id not from EasyPost", { provider_rate_id: `'bogus'` }, /check constraint/],
  ["a shipment id not from EasyPost", { provider_shipment_id: `'shp_'` }, /check constraint/],
  ["an empty cart", { cart_item_ids: `ARRAY[]::uuid[]` }, /check constraint/],
  ["the seller quoting their own item", { seller_id: `'${BUYER2}'` }, /shipping_quotes_not_own|check constraint/],
  ["a quote living longer than 30 minutes", { expires_at: `now() + interval '31 minutes'` }, /shipping_quotes_short_lived|check constraint/],
  ["an unknown mode", { label_mode: `'production'` }, /check constraint/],
]) {
  const sql = quote(BUYER2, over);
  ok(refused(await svc(sql), re), `${label} is refused`);
}
ok(one(await svc(`SELECT (expires_at - created_at) = interval '30 minutes' FROM public.shipping_quotes WHERE id = '${q1id}'`)) === true,
  "a quote expires 30 minutes after it is made");

// Frozen once stored: a new price is a new quote.
ok(refused(await svc(`UPDATE public.shipping_quotes SET rate_cents = 1 WHERE id = '${q1id}'`), /shipping_quote_frozen/),
  "a stored quote's price cannot be changed");
ok(refused(await svc(`UPDATE public.shipping_quotes SET ship_to = '{"zip":"70808"}'::jsonb WHERE id = '${q1id}'`), /shipping_quote_frozen/),
  "a stored quote's address cannot be changed");

// Service-role only: no member (not even the buyer) and no anon can read or write it.
ok(refused(await me(BUYER2, `SELECT * FROM public.shipping_quotes`), /permission denied/), "the buyer cannot read quotes directly");
ok(refused(await me(null, `SELECT * FROM public.shipping_quotes`), /permission denied/), "anon cannot read quotes");
ok(refused(await me(BUYER2, quote(BUYER2)), /permission denied/), "the buyer cannot write a quote directly");
ok(one(await svc(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.shipping_quotes'::regclass`)) === true, "RLS is on");
const guardAcl = one(await svc(`SELECT proacl::text FROM pg_proc WHERE oid = 'public.shipping_quotes_guard()'::regprocedure`)) ?? "";
ok(!/(^|[{,])=X|anon=X|authenticated=X/.test(guardAcl), `the guard function is not executable by PUBLIC, anon or members (${guardAcl})`);

// The parcel preset on a listing: small items only, the four presets only, NULL = does not ship.
const ITEM = "5a5a5a5a-0000-0000-0000-000000000901";
await run(liveItemSql({ id: ITEM, seller: SELLER, title: "Ship mug", price: 1000, floor: 100 }));
await run(`UPDATE public.declutter_items SET delivery_size = 'small' WHERE id = '${ITEM}'`);
ok(Array.isArray(await svc(`UPDATE public.declutter_items SET ship_preset = 'small_box' WHERE id = '${ITEM}' RETURNING id`)),
  "a small item takes a parcel preset");
ok(refused(await svc(`UPDATE public.declutter_items SET ship_preset = 'crate' WHERE id = '${ITEM}'`), /declutter_items_ship_preset_check/),
  "an unknown parcel preset is refused");
ok(refused(await svc(`UPDATE public.declutter_items SET delivery_size = 'large' WHERE id = '${ITEM}'`), /declutter_items_ship_preset_check/),
  "a large item cannot keep a parcel preset (small only, decision 8)");
ok(one(await svc(`SELECT count(*) FROM public.declutter_items WHERE ship_preset IS NOT NULL AND id <> '${ITEM}'`)) === 0,
  "every other listing has no preset (does not ship) by default");

// Expired quotes can be cleaned up by the service role (DELETE is not frozen); a deleted account takes its quotes.
ok(Array.isArray(await svc(`DELETE FROM public.shipping_quotes WHERE id = '${q1id}' RETURNING id`)), "the service role can delete a quote");
const n0 = Number(one(await svc(`SELECT count(*) FROM public.shipping_quotes WHERE buyer_id = '${ADMIN}'`)));
await run(`DELETE FROM auth.users WHERE id = '${ADMIN}'`);
const n1 = Number(one(await svc(`SELECT count(*) FROM public.shipping_quotes WHERE buyer_id = '${ADMIN}'`)));
ok(n0 === 1 && n1 === 0, `a deleted account's quotes go with it (${n0} -> ${n1})`);

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip: RED baseline)" : ""}`);
if (fail) process.exit(1);

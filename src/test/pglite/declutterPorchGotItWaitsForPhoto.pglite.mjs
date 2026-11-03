#!/usr/bin/env node
/**
 * PGlite proof for 20261103202118_declutter_porch_got_it_waits_for_photo (BUY-17, owner 11-03; lead call for the
 * photo half): a porch sale finishes only after the seller's porch photo (declutter_handovers.set_out_at). Before it,
 * the buyer's "I got it" (declutter_confirm_handover) and the buyer's "Picked up" photo (declutter_porch_photo, buyer
 * side) are both refused with porch_photo_not_in (22023, so PostgREST answers 400, not 500), on the booked day too, and nothing is handed over or paid. After
 * it, "I got it" hands the order over as before. A door pickup is unchanged.
 *
 *   node src/test/pglite/declutterPorchGotItWaitsForPhoto.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPorchGotItWaitsForPhoto.pglite.mjs  # RED: prod's bodies
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterPorchGotItWaitsForPhoto.pglite.mjs
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, then the NEWEST definition of each of the two functions before
 * this migration, read from the migration files, so NEW_MIGRATION=skip runs PROD's bodies (md5 checked against
 * read-only prod SQL). Functions they call that the world lacks are only reached after the refusal under test.
 * Then this migration 3 times. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import { readFileSync, readdirSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261103202118_declutter_porch_got_it_waits_for_photo.sql";
// md5(prosrc) on prod (read-only SQL on fncmgoasalhdgfwzhsqa, 2026-11-03).
const PROD_MD5 = { declutter_confirm_handover: "ce8b5ecf9b79cdaf9aedf0a6b5fc37d5", declutter_porch_photo: "31f51f708c0ce93fecb71b12dac203ed" };
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER, BUYER, BUYER2, BUYER3 } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}
await run(`SET check_function_bodies = off`);
for (const fn of Object.keys(PROD_MD5)) {
  const r = await run(definitionBefore(fn, NEW_FILE));
  if (r?.error) throw new Error(`${fn}: ${r.error}`);
  const md5 = one(await svc(`SELECT md5(prosrc) FROM pg_proc WHERE proname = '${fn}' AND pronamespace = 'public'::regnamespace`));
  ok(md5 === PROD_MD5[fn], `the world's ${fn} is prod's body before this migration (md5 ${md5?.slice(0, 8)})`);
}
// Prod's porch_photo (20261030164712 onward) reads the order's pickup points; the world predates it, so stub it to
// the item's own point (reached only past the refusal under test, on the seller's photo).
// Prod's confirm_handover (20261031004529) withdraws the 60-day system hold; the world's problems table predates it.
await run(`ALTER TABLE public.declutter_problems ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz`);
await run(`CREATE OR REPLACE FUNCTION public.declutter_order_pickup_points(p uuid) RETURNS TABLE(lat numeric, lng numeric)
  LANGUAGE sql AS $$ SELECT 30.2241::numeric, -92.0198::numeric $$`);

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `4e4e4e4e-0000-0000-0000-${String(n).padStart(12, "0")}`;
const status = async (id) => one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${id}'`));
const payouts = async (id) => one(await svc(`SELECT count(*)::int FROM public.declutter_payouts WHERE order_id = '${id}'`));
const confirm = (uid, id) => me(uid, `SELECT public.declutter_confirm_handover('${id}', 'buyer', NULL) AS r`);
const buyerPhoto = (uid, id) => me(uid, `SELECT public.declutter_porch_photo('${id}', '${uid}/declutter/handover/${id}/p.jpg', 30.2241, -92.0198) AS r`);
async function paidOrder(n, buyer, how) {
  await run(liveItemSql({ id: I(n), seller: SELLER, title: `Porch item ${n}`, price: 2000, floor: 100 }));
  await svc(`UPDATE public.declutter_items SET porch_ok = true WHERE id = '${I(n)}'`);
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', 2000)`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${SELLER}', '${how}')`))?.[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_buy17_${n}', ${o?.total_cents}, now(), 150)`);
  // Booked for now (setup only: a direct write): it is the pickup day and time.
  await svc(`INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end)
    VALUES ('${o?.order_id}', '${buyer}', '${SELLER}', now() - interval '10 minutes', now() + interval '20 minutes')
    ON CONFLICT DO NOTHING`);
  const h = await svc(`INSERT INTO public.declutter_handovers (order_id, code) VALUES ('${o?.order_id}', '0000') ON CONFLICT DO NOTHING`);
  if (!Array.isArray(h)) console.log(`fixture note: handover insert: ${h.error}`);
  return o?.order_id;
}

// 1. Porch, booked, the pickup time has come, no porch photo: "I got it" refused; nothing handed over or paid.
const P = await paidOrder(1, BUYER, "porch");
ok(!!P && (await status(P)) === "paid", "fixture: a paid porch order, booked for now");
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_bookings WHERE order_id = '${P}' AND slot_start IS NOT NULL`)) === 1, "fixture: its booking exists");
const early = await confirm(BUYER, P);
ok(refused(early, /porch_photo_not_in/) && early.code === "22023" && (await status(P)) === "paid", `no porch photo: "I got it" refused, porch_photo_not_in (${early?.error ?? "accepted"})`);
ok((await payouts(P)) === 0, "no payout row while refused");

// 2. The buyer's "Picked up" photo before the seller's porch photo: refused the same way, nothing recorded.
const ph = await buyerPhoto(BUYER, P);
ok(refused(ph, /porch_photo_not_in/) && ph.code === "22023" && (await status(P)) === "paid", `no porch photo: the buyer's pickup photo refused, porch_photo_not_in (${ph?.error ?? "accepted"})`);
ok(one(await svc(`SELECT picked_up_at FROM public.declutter_handovers WHERE order_id = '${P}'`)) == null, "no picked_up_at recorded");
// The seller still cannot confirm for the buyer (the side check comes first).
ok(refused(await confirm(SELLER, P), /wrong_side/), "the seller still cannot tap I got it (wrong_side)");

// 3. Once the seller's porch photo is in, "I got it" hands it over.
await svc(`UPDATE public.declutter_handovers SET set_out_at = now(), set_out_photo_path = '${SELLER}/declutter/handover/${P}/out.jpg' WHERE order_id = '${P}'`);
const got = await confirm(BUYER, P);
ok(Array.isArray(got) && (await status(P)) === "handed_over", `with the porch photo: "I got it" hands it over${Array.isArray(got) ? "" : `: ${got?.error}`}`);

// 4. With the porch photo in, the buyer's pickup photo passes the new gate (it then stops at photo_not_uploaded: no
//    storage object in this world), so the gate never refuses a photo-backed porch pickup.
const P2 = await paidOrder(2, BUYER2, "porch");
ok(!!P2 && (await status(P2)) === "paid", `fixture: a second paid porch order (${P2})`);
await svc(`UPDATE public.declutter_handovers SET set_out_at = now(), set_out_photo_path = '${SELLER}/declutter/handover/${P2}/out.jpg' WHERE order_id = '${P2}'`);
const ph2 = await buyerPhoto(BUYER2, P2);
ok(refused(ph2, /photo_not_uploaded/), `with the porch photo: the buyer's pickup photo is past the gate (${ph2?.error ?? "accepted"})`);

// 5. A door pickup is unchanged: no porch photo needed (59 minutes after the booked time it confirms).
const D = await paidOrder(3, BUYER3, "pickup_home");
const dr = await confirm(BUYER3, D);
ok(!!D && Array.isArray(dr) && (await status(D)) === "handed_over", `a door pickup: "I got it" works as before${Array.isArray(dr) ? "" : `: ${dr?.error}`}`);

// 6. Grants as prod has them.
for (const sig of ["declutter_confirm_handover(uuid, text, text)", "declutter_porch_photo(uuid, text, numeric, numeric)"]) {
  ok(one(await svc(`SELECT has_function_privilege('anon', 'public.${sig}', 'EXECUTE')`)) === false, `anon cannot run ${sig}`);
  ok(one(await svc(`SELECT has_function_privilege('authenticated', 'public.${sig}', 'EXECUTE')`)) === true, `members can run ${sig}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

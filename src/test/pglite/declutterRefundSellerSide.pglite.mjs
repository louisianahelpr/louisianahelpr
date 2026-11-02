#!/usr/bin/env node
/**
 * PGlite proof for 20261102041000_declutter_refund_seller_side (A3-74, audit 11-01; lead 11-01: decide_by = 48 h,
 * display only). The seller's "I don't agree" and part offer carry an optional note and up to 3 photos; when the
 * refund reaches Louisiana Helpr they are the seller's side of the problem the admin reads; the problem gets decide_by
 * (now + 48 h); both sides read the seller's side, the problem and decide_by through declutter_refund_request_view.
 *
 *   node src/test/pglite/declutterRefundSellerSide.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterRefundSellerSide.pglite.mjs # RED: the chain without it
 *   MIGRATION_PATH=<planted copy> node ...                                       # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs plus the migration chain of declutterNeverGotItNoReturn.pglite.mjs,
 * then the newest definitions this file sits on (20261031010243, 20261030143141, 20261031100935). Supabase's DEFAULT
 * PRIVILEGES (EXECUTE on new functions to anon, authenticated, service_role) are switched on right before the new
 * migration, so a restated function that loses its REVOKE shows anon=X.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261102041000_declutter_refund_seller_side.sql";
const BASES = [
  "20261027171453_declutter_withdraw_refund_not_once_returning.sql",
  "20261027211754_declutter_bundle_discount.sql",
  "20261028200440_declutter_audit3_notices_and_empty_cart.sql",
  "20261028235247_declutter_handover_choices.sql",
  "20261028235709_declutter_handover_photos_at_the_address.sql",
  "20261029000048_declutter_false_report_strike.sql",
  "20261029002010_declutter_handover_photos_live_only.sql",
  "20261029161347_declutter_porch_weekdays.sql",
  "20261029201542_declutter_porch_photo_not_before_the_day.sql",
  "20261029224147_declutter_admin_decision_closes_refund_request.sql",
  "20261029225634_declutter_problem_both_sides_and_photos.sql",
  "20261029232103_declutter_refund_debt_notice.sql",
  "20261030071818_declutter_returns.sql",
  "20261030164712_declutter_porch_places.sql",
  "20261031010243_declutter_never_got_it_no_return.sql",
];
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { db, svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER2, BUYER2 } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const short = (r) => JSON.stringify(r)?.slice(0, 260);

for (const f of BASES) {
  const r = await run(readFileSync(`${MIG_DIR}${f}`, "utf8"));
  if (r?.error) ok(false, `base ${f} applies: ${r.error}`);
}
await run(`CREATE OR REPLACE FUNCTION public.declutter_order_items_named(p_order_id uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'the items'::text $$;`);
if (!skip) {
  await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;`);
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `eeeeeeee-0000-0000-0000-${String(n).padStart(12, "0")}`;
async function handedOver(n) {
  await run(liveItemSql({ id: I(n), seller: SELLER2, title: `Refund item ${n}`, price: 3000, floor: 100 }));
  await me(BUYER2, `SELECT public.declutter_buy_now('${I(n)}', 3000)`);
  const o = (await me(BUYER2, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`))?.[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_side_${n}', ${o?.total_cents}, now(), 150)`);
  await svc(`SELECT public.declutter_complete_handover('${o?.order_id}', 'auto')`);
  return { id: o?.order_id, total: o?.total_cents };
}
const ask = async (id) => one(await me(BUYER2, `SELECT public.declutter_ask_refund('${id}', 'damaged', 'It came cracked') AS r`))?.request_id;
const photo = async (uid, order, name) => {
  const path = `${uid}/declutter/problem/${order}/${name}`;
  await svc(`INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('declutter-handover', '${path}', '${uid}')`);
  return path;
};
const arr = (xs) => `ARRAY[${xs.map((x) => `'${x}'`).join(", ")}]::text[]`;
const view = async (uid, id) => (await me(uid, `SELECT public.declutter_refund_request_view('${id}') AS v`))?.[0]?.v;
const problem = async (id) => (await svc(`SELECT reporter_side, other_side_note, other_side_photo_paths, other_side_at, decide_by,
  extract(epoch FROM decide_by - now()) / 3600 AS hours FROM public.declutter_problems WHERE order_id = '${id}' AND status = 'open'`))?.[0];

// 1. "I don't agree" with words and two photos; the buyer then reports a problem.
const A = await handedOver(1);
const qA = await ask(A.id);
const p1 = await photo(SELLER2, A.id, "handover1.jpg");
const p2 = await photo(SELLER2, A.id, "handover2.jpg");
const notUp = `${SELLER2}/declutter/problem/${A.id}/never.jpg`;
const theirs = await photo(BUYER2, A.id, "buyer.jpg");
const call = (p) => me(SELLER2, `SELECT public.declutter_answer_refund('${qA}', 'decline', NULL, ${p}) AS r`);
ok(refused(await call(`'x', ${arr([notUp])}`), /photo_not_uploaded/), "a photo that was never uploaded is refused");
ok(refused(await call(`'x', ${arr([theirs])}`), /photo_not_uploaded/), "a photo from someone else's folder is refused");
ok(refused(await call(`'x', ${arr([p1, p2, p1, p2])}`), /too_many_problem_photos/), "4 photos are refused");
ok(refused(await call(`repeat('a', 1001), '{}'`), /note_too_long/), "a note over 1,000 characters is refused");
const dA = await call(`'  It worked when they picked it up.  ', ${arr([p1, p2])}`);
ok(dA?.[0]?.r?.result === "declined", `"I don't agree" with words and photos is sent (${short(dA)})`);
const rA = (await svc(`SELECT status, seller_note, seller_photo_paths, seller_side_at FROM public.declutter_refund_requests WHERE id = '${qA}'`))?.[0];
ok(rA?.status === "declined" && rA?.seller_note === "It worked when they picked it up." && rA?.seller_photo_paths?.length === 2 && !!rA?.seller_side_at,
  `  stored on the request, trimmed (${short(rA)})`);
const vA = await view(BUYER2, A.id);
ok(vA?.request?.seller_note === "It worked when they picked it up." && vA?.request?.seller_photo_paths?.length === 2, "  the buyer reads the seller's side");
ok(vA?.request?.decide_by == null, "  no decide-by before Louisiana Helpr has it");
const rep = await me(BUYER2, `SELECT public.declutter_report_problem('${A.id}', 'damaged', 'Still cracked', '{}') AS r`);
ok(!rep?.error, `the buyer reports a problem after the no (${short(rep)})`);
const pA = await problem(A.id);
ok(pA?.other_side_note === "It worked when they picked it up." && pA?.other_side_photo_paths?.length === 2 && !!pA?.other_side_at,
  `  the seller's side is the problem's other side, which the admin's card shows (${short(pA)})`);
ok(pA && Number(pA.hours) > 47.9 && Number(pA.hours) <= 48, `  Louisiana Helpr decides by now + 48 h (${pA?.hours} h)`);

// 2. A part offer with words; the buyer asks Louisiana Helpr to decide.
const B = await handedOver(2);
const qB = await ask(B.id);
const oB = await me(SELLER2, `SELECT public.declutter_answer_refund('${qB}', 'part', 500, 'A small scratch only', '{}') AS r`);
ok(oB?.[0]?.r?.result === "offered" && oB?.[0]?.r?.offer_cents === 500, `a part offer with words is sent, the amount unchanged (${short(oB)})`);
const toAdmin = await me(BUYER2, `SELECT public.declutter_answer_refund_offer('${qB}', false) AS r`);
ok(!toAdmin?.error, `the buyer asks Louisiana Helpr to decide (${short(toAdmin)})`);
const pB = await problem(B.id);
ok(pB?.other_side_note === "A small scratch only" && Number(pB?.hours) > 47.9, `  the problem carries the seller's words and decide_by (${short(pB)})`);
const vB = await view(SELLER2, B.id);
ok(vB?.request?.status === "to_admin" && typeof vB?.request?.decide_by === "string" && typeof vB?.request?.problem_id === "string",
  `  both sides read decide_by and the problem (${short(vB?.request)})`);
ok(typeof (await view(BUYER2, B.id))?.request?.decide_by === "string", "  the buyer too");

// 3. Photos only, no words: the problem reads "The seller added photos.".
const C = await handedOver(3);
const qC = await ask(C.id);
const pc = await photo(SELLER2, C.id, "only.jpg");
await me(SELLER2, `SELECT public.declutter_answer_refund('${qC}', 'decline', NULL, NULL, ${arr([pc])})`);
await me(BUYER2, `SELECT public.declutter_report_problem('${C.id}', 'damaged', 'Cracked', '{}')`);
const pC = await problem(C.id);
ok(pC?.other_side_note === "The seller added photos." && pC?.other_side_photo_paths?.[0] === pc, `photos alone still reach Louisiana Helpr (${short(pC)})`);

// 4. No side at all: nothing is invented; decide_by still set.
const D = await handedOver(4);
const qD = await ask(D.id);
await me(SELLER2, `SELECT public.declutter_answer_refund('${qD}', 'decline', NULL)`);
const rD = (await svc(`SELECT seller_note, seller_side_at FROM public.declutter_refund_requests WHERE id = '${qD}'`))?.[0];
ok(rD?.seller_note == null && rD?.seller_side_at == null, "the old 3-argument call still works, with no side stored");
await me(BUYER2, `SELECT public.declutter_report_problem('${D.id}', 'damaged', 'Cracked', '{}')`);
const pD = await problem(D.id);
ok(pD?.other_side_note == null && Number(pD?.hours) > 47.9, `  no side invented; decide_by set (${short(pD)})`);
const add = await me(SELLER2, `SELECT public.declutter_problem_add_side((SELECT id FROM public.declutter_problems WHERE order_id = '${D.id}'), 'Late words', '{}') AS r`);
ok(!add?.error && (await problem(D.id))?.other_side_note === "Late words", "  the seller can still add their side to the problem");

// 5. "Refund in full" stores no side and changes nothing in the money path.
const E = await handedOver(5);
const qE = await ask(E.id);
const fE = await me(SELLER2, `SELECT public.declutter_answer_refund(p_request_id => '${qE}', p_answer => 'full', p_offer_cents => NULL) AS r`);
ok(fE?.[0]?.r?.result === "returning", `the old named-argument call resolves to the new function (${short(fE)})`);

// 6. The join path: a request that reaches to_admin onto a problem already open fills it, never overwriting.
const F = await handedOver(6);
const qF = await ask(F.id);
await svc(`INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note) VALUES ('${F.id}', '${BUYER2}', 'buyer', 'damaged', 'first')`);
await svc(`UPDATE public.declutter_problems SET decide_by = NULL WHERE order_id = '${F.id}'`);
await svc(`UPDATE public.declutter_refund_requests SET seller_note = 'Joined side', seller_side_at = now() WHERE id = '${qF}'`);
await svc(`UPDATE public.declutter_refund_requests SET status = 'to_admin', problem_id = (SELECT id FROM public.declutter_problems WHERE order_id = '${F.id}') WHERE id = '${qF}'`);
const pF = await problem(F.id);
ok(pF?.other_side_note === "Joined side" && Number(pF?.hours) > 47.9, `joining an open problem fills the seller's side and decide_by (${short(pF)})`);
await svc(`UPDATE public.declutter_problems SET other_side_note = 'Seller typed this' WHERE order_id = '${F.id}'`);
await svc(`UPDATE public.declutter_refund_requests SET status = 'declined', declined_at = now() WHERE id = '${qF}'`);
await svc(`UPDATE public.declutter_refund_requests SET status = 'to_admin' WHERE id = '${qF}'`);
ok((await problem(F.id))?.other_side_note === "Seller typed this", "  a side the seller already gave is never overwritten");

// 7. The insert trigger alone (the request stays as it is): any problem on a sale with a refund request gets decide_by
//    and, from a buyer, the seller's side (photos alone included); a side given at insert is kept.
const G = await handedOver(7);
const qG = await ask(G.id);
const pg = await photo(SELLER2, G.id, "g.jpg");
await me(SELLER2, `SELECT public.declutter_answer_refund('${qG}', 'decline', NULL, NULL, ${arr([pg])})`);
await svc(`INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note) VALUES ('${G.id}', '${BUYER2}', 'buyer', 'damaged', 'direct')`);
const pG = (await svc(`SELECT other_side_note, other_side_photo_paths, extract(epoch FROM decide_by - now()) / 3600 AS hours,
  (SELECT status FROM public.declutter_refund_requests WHERE id = '${qG}') AS req FROM public.declutter_problems WHERE order_id = '${G.id}'`))?.[0];
ok(pG?.req === "declined" && pG?.other_side_note === "The seller added photos." && pG?.other_side_photo_paths?.[0] === pg && Number(pG?.hours) > 47.9,
  `on insert alone: decide_by and the seller's photos (${short(pG)})`);
const H = await handedOver(8);
const qH = await ask(H.id);
await me(SELLER2, `SELECT public.declutter_answer_refund('${qH}', 'decline', NULL, 'Seller words', '{}')`);
await svc(`INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, other_side_note) VALUES ('${H.id}', '${BUYER2}', 'buyer', 'damaged', 'again', 'Given at insert')`);
ok(one(await svc(`SELECT other_side_note FROM public.declutter_problems WHERE order_id = '${H.id}' AND status = 'open'`)) === "Given at insert", "  a side given at insert is kept");

// 8. Grants (Supabase default anon grant emulated): never anon.
const acl = async (name) => (await svc(`SELECT string_agg(coalesce(proacl::text, ''), ' ') AS a FROM pg_proc WHERE proname = '${name}'`))?.[0]?.a ?? "";
for (const fn of ["declutter_answer_refund", "declutter_refund_request_view"]) {
  const a = await acl(fn);
  ok(a.includes("authenticated=X") && !a.includes("anon=X") && !/(^|[{,])=X/.test(a), `${fn}: authenticated, never anon or PUBLIC (${a})`);
}
for (const fn of ["declutter_problem_refund_side", "declutter_refund_seller_side_to_problem"]) {
  const a = await acl(fn);
  ok(a !== "" && !a.includes("anon=X") && !a.includes("authenticated=X") && !/(^|[{,])=X/.test(a), `${fn}: callable by nobody (${a})`);
}
ok(Number(one(await svc(`SELECT count(*) AS n FROM pg_proc WHERE proname = 'declutter_answer_refund'`))) === 1, "only one declutter_answer_refund (the old signature is gone)");

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);

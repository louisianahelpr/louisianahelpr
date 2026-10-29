#!/usr/bin/env node
/**
 * PGlite proof for 20261029225634_declutter_problem_both_sides_and_photos (Declutter audit 1b #3; Builder 45's two
 * server gaps): a second report is refused with words (never dropped), the other side adds its words and photos to
 * an open problem, a refund request carries photos that reach Louisiana Helpr with it, and problem-folder photos
 * can be uploaded after the handover while a problem or a request is live.
 *
 *   node src/test/pglite/declutterProblemBothSides.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterProblemBothSides.pglite.mjs  # RED: the bodies before it
 *   MIGRATION_PATH=<planted copy> node ...                                        # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, the newest declutter_admin_decide_problem before D2-5
 * (20261029000048, its statement only), D2-5 (20261029224147, whose view this restates) once, this migration 3x.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261029225634_declutter_problem_both_sides_and_photos.sql";
const D25 = "20261029224147_declutter_admin_decision_closes_refund_request.sql";
const DECIDE_BASE = "20261029000048_declutter_false_report_strike.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER, BUYER, BUYER2, BUYER3, ADMIN } = USERS;

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

{
  const s = readFileSync(`${MIG_DIR}${DECIDE_BASE}`, "utf8");
  const r = await run(s.slice(s.indexOf("DROP FUNCTION IF EXISTS public.declutter_admin_decide_problem(")));
  ok(!r?.error, `base ${DECIDE_BASE} (decide_problem) applies${r?.error ? `: ${r.error}` : ""}`);
}
await run(`DO $$ BEGIN
  IF to_regprocedure('public.declutter_order_items_named(uuid)') IS NULL THEN
    CREATE FUNCTION public.declutter_order_items_named(p_order uuid) RETURNS text LANGUAGE sql STABLE AS
      $f$ SELECT '"' || string_agg(i.title, '", "') || '"' FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id WHERE c.order_id = p_order $f$;
  END IF;
END $$;`);
{
  const r = await run(readFileSync(`${MIG_DIR}${D25}`, "utf8"));
  ok(!r?.error, `base ${D25} applies${r?.error ? `: ${r.error}` : ""}`);
}
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `33553355-0000-0000-0000-${String(n).padStart(12, "0")}`;
const CARD_FEE = 150;
async function paid(n, buyer, price) {
  await run(liveItemSql({ id: I(n), seller: SELLER, title: `Sides item ${n}`, price, floor: Math.min(price, 100) }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))?.[0] ?? {};
  await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_sides_${n}', ${o.total_cents}, now(), ${CARD_FEE})`);
  return o;
}
const gotIt = (buyer, id) => me(buyer, `SELECT public.declutter_confirm_handover('${id}', 'buyer', NULL) AS r`);
const put = async (path) => { await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('declutter-handover', '${path}')`); return path; };
const arr = (xs) => (xs.length ? `ARRAY[${xs.map((x) => `'${x}'`).join(", ")}]::text[]` : `'{}'::text[]`);
const report = (uid, id, reason, note) => me(uid, `SELECT public.declutter_report_problem('${id}', '${reason}', '${note}', NULL) AS r`);
const addSide = (uid, pid, note, photos = []) => me(uid, `SELECT public.declutter_problem_add_side('${pid}', '${note}', ${arr(photos)}) AS r`);
const problem = async (id) => (await svc(`SELECT * FROM public.declutter_problems WHERE order_id = '${id}' ORDER BY created_at DESC LIMIT 1`))?.[0] ?? {};
const access = async (uid, path) => one(await me(uid, `SELECT public.declutter_handover_photo_access('${path}', true)`));

// 1. A second report: never dropped silently.
const A = await paid(1, BUYER, 1200);
const pid = one(await report(BUYER, A.order_id, "damaged", "The leg is cracked."));
ok(typeof pid === "string", "fixture: the buyer reports a problem on a paid order");
ok(one(await report(BUYER, A.order_id, "damaged", "The leg is cracked.")) === pid, "the same report sent again (a double tap) answers the same problem");
ok(refused(await report(SELLER, A.order_id, "other", "The buyer never came."), /problem_already_open/),
  "the seller's report on that sale is refused (problem_already_open: add your side), not answered with the buyer's id");
ok(refused(await report(BUYER, A.order_id, "not_received", "Actually it never came."), /problem_already_reported/),
  "the buyer's different second report is refused (problem_already_reported), not dropped");
ok((await problem(A.order_id)).note === "The leg is cracked.", "  and the open report is unchanged");

// 2. The other side adds its words and photos.
{
  const p1 = await put(`${SELLER}/declutter/problem/${A.order_id}/s1.jpg`);
  const r = await addSide(SELLER, pid, "It left here in one piece.", [p1]);
  ok(one(r)?.result === "added", `the seller adds their side with a photo${Array.isArray(r) ? "" : `: ${r?.error}`}`);
  const p = await problem(A.order_id);
  ok(p.other_side_note === "It left here in one piece." && JSON.stringify(p.other_side_photo_paths) === JSON.stringify([p1]) && !!p.other_side_at,
    "  saved on the problem: words, photo, when");
  const n = (await svc(`SELECT message FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'The other side answered' ORDER BY created_at DESC LIMIT 1`))?.[0]?.message ?? "";
  ok(/seller added their side/.test(n), "  the buyer is told");
  ok(refused(await addSide(BUYER, pid, "Mine too."), /problem_side_is_yours/), "the reporter cannot add a side to their own report");
  ok(refused(await addSide(BUYER3, pid, "Me."), /problem_not_found/), "a stranger is not told it exists");
  const others = await put(`${BUYER}/declutter/problem/${A.order_id}/b.jpg`);
  ok(refused(await addSide(SELLER, pid, "x", [others]), /photo_not_uploaded/), "a photo from someone else's folder is refused");
  ok(refused(await addSide(SELLER, pid, "x", [`${SELLER}/declutter/problem/${A.order_id}/missing.jpg`]), /photo_not_uploaded/), "a photo never uploaded is refused");
  const four = [];
  for (let i = 0; i < 4; i++) four.push(await put(`${SELLER}/declutter/problem/${A.order_id}/f${i}.jpg`));
  ok(refused(await addSide(SELLER, pid, "x", four), /too_many_problem_photos/), "more than 3 photos is refused");
  ok(refused(await addSide(SELLER, pid, "   "), /note_required/), "empty words are refused");
  await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${pid}', 'refund_buyer', 'none', false, 'ok', false)`);
  ok(refused(await addSide(SELLER, pid, "Late."), /problem_already_decided/), "after the decision, no side can be added");
}

// 3. A refund request with photos; they reach Louisiana Helpr with it.
const B = await paid(2, BUYER2, 2000);
await gotIt(BUYER2, B.order_id);
{
  const bp = `${BUYER2}/declutter/problem/${B.order_id}/torn.jpg`;
  ok(await access(BUYER2, bp) === true, "after the handover, the buyer may upload into their problem folder (the 24-hour window is open)");
  ok(await access(BUYER2, `${BUYER2}/declutter/handover/${B.order_id}/x.jpg`) === false, "  but not into the handover folder (handover photos: paid orders only)");
  ok(await access(BUYER3, `${BUYER3}/declutter/problem/${B.order_id}/x.jpg`) === false, "  and a stranger never");
  await put(bp);
  const r = one(await me(BUYER2, `SELECT public.declutter_ask_refund('${B.order_id}', 'damaged', 'Torn shade.', ARRAY['${bp}']) AS r`));
  ok(r?.result === "asked", "the buyer asks for a refund with a photo");
  const req = (await svc(`SELECT * FROM public.declutter_refund_requests WHERE order_id = '${B.order_id}'`))?.[0] ?? {};
  ok(JSON.stringify(req.photo_paths) === JSON.stringify([bp]), "  the photo is stored on the request");
  const v = one(await me(SELLER, `SELECT public.declutter_refund_request_view('${B.order_id}') AS v`));
  ok(JSON.stringify(v?.request?.photo_paths) === JSON.stringify([bp]), "  and the seller sees it in the request");
  await svc(`UPDATE public.declutter_orders SET handed_over_at = now() - interval '30 hours' WHERE id = '${B.order_id}'`);
  ok(await access(SELLER, `${SELLER}/declutter/problem/${B.order_id}/s.jpg`) === true, "30 hours on, a waiting request still lets the seller upload problem photos");
  const prob = one(await svc(`SELECT public.declutter_refund_request_to_admin('${req.id}', 'No answer in 24 hours.')`));
  const p = (await svc(`SELECT photo_paths FROM public.declutter_problems WHERE id = '${prob}'`))?.[0];
  ok(JSON.stringify(p?.photo_paths) === JSON.stringify([bp]), "sent to Louisiana Helpr, the request's photo is on the problem it opens");
}
// 3b. The three old named arguments still reach ask_refund.
{
  const C = await paid(3, BUYER3, 900);
  await gotIt(BUYER3, C.order_id);
  const r = one(await me(BUYER3, `SELECT public.declutter_ask_refund(p_order_id => '${C.order_id}', p_reason => 'damaged', p_note => 'Cracked.') AS r`));
  ok(r?.result === "asked", "a call with the three old named arguments still asks");
  const overloads = Number(one(await svc(`SELECT count(*) FROM pg_proc WHERE proname = 'declutter_ask_refund'`)));
  ok(overloads === 1, "one declutter_ask_refund, no leftover 3-argument overload");
}

// 4. Grants.
{
  const acl = async (role, fn) => one(await svc(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE')`));
  ok(await acl("anon", "public.declutter_problem_add_side(uuid, text, text[])") === false
     && await acl("authenticated", "public.declutter_problem_add_side(uuid, text, text[])") === true, "add_side: members, never anon");
  ok(await acl("anon", "public.declutter_ask_refund(uuid, text, text, text[])") === false, "ask_refund: never anon");
  ok(await acl("authenticated", "public.declutter_refund_request_to_admin(uuid, text)") === false, "to_admin stays service-only");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

#!/usr/bin/env node
/**
 * PGlite proof for 20261030044444_declutter_order_problem_read (Declutter audit 1030 DB-1; same root as DA-7, DC-15):
 * the order card reads its newest problem through a party-scoped definer read, because authenticated's column grant
 * on declutter_problems does not cover other_side_* or decided_by and the old select("*") was refused 42501 on prod.
 *
 *   node src/test/pglite/declutterOrderProblemRead.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterOrderProblemRead.pglite.mjs  # RED: no read before it
 *   MIGRATION_PATH=<planted copy> node ...                                        # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, the newest declutter_admin_decide_problem before D2-5
 * (20261029000048, its statement only), D2-5 (20261029224147) and D2-3 (20261029225634, the other side's columns)
 * once each, then prod's measured column grant (2026-10-30), then this migration 3x.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261030044444_declutter_order_problem_read.sql";
const BOTH_SIDES = "20261029225634_declutter_problem_both_sides_and_photos.sql";
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
for (const f of [D25, BOTH_SIDES]) {
  const r = await run(readFileSync(`${MIG_DIR}${f}`, "utf8"));
  ok(!r?.error, `base ${f} applies${r?.error ? `: ${r.error}` : ""}`);
}
// Prod's grant, measured 2026-10-30 (information_schema.column_privileges): 15 columns, no other_side_*, no decided_by.
await run(`REVOKE ALL ON public.declutter_problems FROM authenticated;
  GRANT SELECT (admin_note, created_at, decided_at, decision, fault, id, is_seed, note, order_id, photo_paths, reason,
    reporter_id, reporter_side, status, strike_given) ON public.declutter_problems TO authenticated;`);
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `44664466-0000-0000-0000-${String(n).padStart(12, "0")}`;
async function paid(n, buyer, price) {
  await run(liveItemSql({ id: I(n), seller: SELLER, title: `Read item ${n}`, price, floor: Math.min(price, 100) }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))?.[0] ?? {};
  await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_read_${n}', ${o.total_cents}, now(), 150)`);
  return o;
}
const read = (uid, id) => me(uid, `SELECT public.declutter_order_problem('${id}') AS p`);
const put = async (path) => { await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('declutter-handover', '${path}')`); return path; };

// 0. The defect itself: the old select("*") as a member is refused (prod's grant).
const A = await paid(1, BUYER, 1200);
ok(refused(await me(BUYER, `SELECT * FROM public.declutter_problems WHERE order_id = '${A.order_id}'`), /permission denied/),
  "the old read (select * as a member) is refused 42501 under prod's column grant: the defect");

// 1. No problem yet: NULL, not an error.
{
  const r = await read(BUYER, A.order_id);
  ok(Array.isArray(r) && one(r) === null, `an order with no problem reads NULL for its buyer${Array.isArray(r) ? "" : `: ${r?.error}`}`);
}

// 2. Both sides read the open problem, with only the card's columns.
const pid = one(await me(BUYER, `SELECT public.declutter_report_problem('${A.order_id}', 'damaged', 'The leg is cracked.', NULL) AS r`));
ok(typeof pid === "string", "fixture: the buyer reports a problem");
const sp = await put(`${SELLER}/declutter/problem/${A.order_id}/s1.jpg`);
await me(SELLER, `SELECT public.declutter_problem_add_side('${pid}', 'It left here whole.', ARRAY['${sp}']::text[])`);
const CARD_KEYS = ["created_at", "id", "note", "other_side_note", "other_side_photo_paths", "photo_paths", "reason", "reporter_side", "status"];
for (const [who, uid] of [["buyer", BUYER], ["seller", SELLER], ["admin", ADMIN]]) {
  const p = one(await read(uid, A.order_id)) ?? {};
  ok(p.id === pid && p.status === "open" && p.reporter_side === "buyer" && p.reason === "damaged" && p.note === "The leg is cracked.",
    `the ${who} reads the open problem`);
  ok(p.other_side_note === "It left here whole." && JSON.stringify(p.other_side_photo_paths) === JSON.stringify([sp]),
    "  with the other side's words and photo");
  ok(JSON.stringify(Object.keys(p).sort()) === JSON.stringify(CARD_KEYS),
    `  and only the card's columns (no admin note, decision, fault, strike, decided_by, reporter id): ${Object.keys(p).sort().join(",")}`);
}

// 3. Strangers and unknown orders get the same answer; anon cannot call it.
ok(refused(await read(BUYER3, A.order_id), /problem_not_found/), "a member who is not on the order is refused (problem_not_found)");
ok(refused(await read(BUYER2, "00000000-0000-0000-0000-00000000dead"), /problem_not_found/), "  the same answer as an order that does not exist");
ok(refused(await me(null, `SELECT public.declutter_order_problem('${A.order_id}')`), /permission denied|not_authenticated/), "anon cannot read it");

// 4. Decided: the newest problem still reads, as decided (the card then hides it).
await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${pid}', 'refund_buyer', 'none', false, 'ok', false)`);
ok((one(await read(SELLER, A.order_id)) ?? {}).status === "decided", "after the decision the seller reads it as decided");

// 5. Grants.
{
  const acl = async (role) => one(await svc(`SELECT has_function_privilege('${role}', 'public.declutter_order_problem(uuid)', 'EXECUTE')`));
  ok(await acl("anon") === false && await acl("authenticated") === true, "EXECUTE: members, never anon");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

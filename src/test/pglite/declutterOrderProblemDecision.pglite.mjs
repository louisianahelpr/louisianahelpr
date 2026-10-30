#!/usr/bin/env node
/**
 * PGlite proof for 20261030080104_declutter_order_problem_decision (Declutter audit 1030 DB-12): after Louisiana Helpr
 * decided a reported problem the order card said only "Handed over.", because the card's party-scoped read
 * (declutter_order_problem, 20261030044444) returned no decision. It now returns decision and decided_at, and still
 * never the admin's note, the fault, the strike, decided_by or the reporter's id.
 *
 *   node src/test/pglite/declutterOrderProblemDecision.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterOrderProblemDecision.pglite.mjs  # RED: no decision before it
 *   MIGRATION_PATH=<planted copy> node ...                                            # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, the decide_problem chain the DB-1 proof uses (20261029000048's
 * statement, D2-5 20261029224147, D2-3 20261029225634), prod's measured column grant (2026-10-30), the DB-1 read
 * (20261030044444) once, then this migration 3x.
 */
import { readFileSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261030080104_declutter_order_problem_decision.sql";
const DB1_READ = "20261030044444_declutter_order_problem_read.sql";
const BOTH_SIDES = "20261029225634_declutter_problem_both_sides_and_photos.sql";
const D25 = "20261029224147_declutter_admin_decision_closes_refund_request.sql";
const DECIDE_BASE = "20261029000048_declutter_false_report_strike.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");
const { svc, run, one, me, refused, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER, BUYER, BUYER3, ADMIN } = USERS;

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
// Prod's grant, measured 2026-10-30 (information_schema.column_privileges): 15 columns, decision and decided_at among them.
await run(`REVOKE ALL ON public.declutter_problems FROM authenticated;
  GRANT SELECT (admin_note, created_at, decided_at, decision, fault, id, is_seed, note, order_id, photo_paths, reason,
    reporter_id, reporter_side, status, strike_given) ON public.declutter_problems TO authenticated;`);
{
  const r = await run(readFileSync(`${MIG_DIR}${DB1_READ}`, "utf8"));
  ok(!r?.error, `base ${DB1_READ} (the DB-1 read) applies${r?.error ? `: ${r.error}` : ""}`);
}
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `44664477-0000-0000-0000-${String(n).padStart(12, "0")}`;
async function paid(n, buyer, price) {
  await run(liveItemSql({ id: I(n), seller: SELLER, title: `Decided item ${n}`, price, floor: Math.min(price, 100) }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'pickup_home')`))?.[0] ?? {};
  await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_dec_${n}', ${o.total_cents}, now(), 150)`);
  return o;
}
const read = (uid, id) => me(uid, `SELECT public.declutter_order_problem('${id}') AS p`);
const NEVER = ["admin_note", "fault", "strike_given", "decided_by", "reporter_id"];
const KEYS = ["created_at", "decided_at", "decision", "id", "note", "other_side_note", "other_side_photo_paths", "photo_paths", "reason", "reporter_side", "status"];

// 1. Open: the decision keys are there and NULL.
const A = await paid(1, BUYER, 1200);
const pa = one(await me(BUYER, `SELECT public.declutter_report_problem('${A.order_id}', 'damaged', 'The leg is cracked.', NULL) AS r`));
ok(typeof pa === "string", "fixture: the buyer reports a problem on sale A");
{
  const p = one(await read(SELLER, A.order_id)) ?? {};
  ok(p.status === "open" && "decision" in p && p.decision === null && p.decided_at === null,
    `an open problem reads decision NULL and decided_at NULL: ${JSON.stringify({ decision: p.decision, decided_at: p.decided_at })}`);
}

// 2. Pay the seller: both sides read pay_seller with its time; the private columns never.
await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${pa}', 'pay_seller', 'buyer', true, 'Private admin words.', false)`);
for (const [who, uid] of [["buyer", BUYER], ["seller", SELLER], ["admin", ADMIN]]) {
  const p = one(await read(uid, A.order_id)) ?? {};
  ok(p.status === "decided" && p.decision === "pay_seller" && typeof p.decided_at === "string" && p.decided_at.length > 0,
    `the ${who} reads what Louisiana Helpr decided (pay_seller, with decided_at): ${JSON.stringify({ decision: p.decision, decided_at: p.decided_at })}`);
  ok(NEVER.every((k) => !(k in p)) && !JSON.stringify(p).includes("Private admin words"),
    `  and never the admin's note, fault, strike, decided_by or reporter id: ${Object.keys(p).sort().join(",")}`);
  ok(JSON.stringify(Object.keys(p).sort()) === JSON.stringify(KEYS), "  exactly the card's columns plus decision and decided_at");
}

// 3. Refund the buyer on another sale: refund_buyer.
const B = await paid(2, BUYER, 900);
const pb = one(await me(BUYER, `SELECT public.declutter_report_problem('${B.order_id}', 'not_as_described', 'Wrong colour.', NULL) AS r`));
await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${pb}', 'refund_buyer', 'seller', false, 'x', false)`);
ok((one(await read(BUYER, B.order_id)) ?? {}).decision === "refund_buyer", "a refund decision reads refund_buyer for the buyer");

// 4. The party check is unchanged: a stranger is refused; anon cannot call it.
ok(refused(await read(BUYER3, A.order_id), /problem_not_found/), "a member who is not on the order is refused (problem_not_found)");
ok(refused(await me(null, `SELECT public.declutter_order_problem('${A.order_id}')`), /permission denied|not_authenticated/), "anon cannot read it");
{
  const acl = async (role) => one(await svc(`SELECT has_function_privilege('${role}', 'public.declutter_order_problem(uuid)', 'EXECUTE')`));
  ok(await acl("anon") === false && await acl("authenticated") === true, "EXECUTE: members, never anon");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

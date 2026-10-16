#!/usr/bin/env node
/**
 * PGlite proof for 20261016053639_declutter_haul_away (Declutter haul-away:
 * docs/specs/declutter-haul-away.md), on top of slices 1-4.
 *
 *   node src/test/pglite/declutterHaulAway.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterHaulAway.pglite.mjs    # RED: every check fails
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterHaulAway.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 * public.jobs is stubbed with the live columns the migration reads (id,
 * customer_id, status, payment_status, stripe_session_id: text on prod) and
 * the poster's real DELETE policy (20260903055308), so a seller's own delete
 * runs under RLS and fires ON DELETE SET NULL on the real path.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, BUYER, SELLER2, OUTSIDER, BANNED } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";
const MIG = readFileSync(
  process.env.MIGRATION_PATH ?? new URL("../../../supabase/migrations/20261016053639_declutter_haul_away.sql", import.meta.url).pathname,
  "utf8",
);

const db = new PGlite();
for (const sql of setupStatements({ times: 1, times3b: 1, extra: [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 }] })) await db.exec(sql);
await db.exec(CARDS_SQL);
await db.exec(`CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid,
  status text NOT NULL DEFAULT 'open', payment_status text DEFAULT 'unpaid', stripe_session_id text);
  ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
  GRANT SELECT, DELETE ON public.jobs TO authenticated;
  CREATE POLICY jobs_read ON public.jobs FOR SELECT TO authenticated USING (customer_id = auth.uid());
  CREATE POLICY "Customers can delete their own jobs" ON public.jobs FOR DELETE TO authenticated
    USING ((SELECT auth.uid()) = customer_id AND status = 'open'
           AND ((payment_status = 'unpaid' AND stripe_session_id IS NULL) OR payment_status = 'abandoned'));`);
if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIG);
await db.exec(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT s, d, '09:00', '18:00' FROM unnest(ARRAY['${SELLER}', '${SELLER2}']::uuid[]) s, generate_series(0, 6) d ON CONFLICT DO NOTHING;`);

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
const I = (n) => `66666666-0000-0000-0000-${String(n).padStart(12, "0")}`;
const J = (n) => `77777777-0000-0000-0000-${String(n).padStart(12, "0")}`;
const itemStatus = async (id) => one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${id}'`));
const job = (n, customer, payment = "unpaid", status = "open") =>
  svc(`INSERT INTO public.jobs (id, customer_id, status, payment_status) VALUES ('${J(n)}', '${customer}', '${status}', '${payment}')`);
const link = (uid, ids, j) => me(uid, `SELECT public.declutter_link_haul_away(ARRAY[${ids.map((x) => `'${x}'`).join(",")}]::uuid[], '${j}') AS n`);
const state = async (uid, ids) => {
  const r = await me(uid, `SELECT item_id, state, job_id, pickup_group, photo_paths FROM public.declutter_haul_away_state(${ids ? `ARRAY[${ids.map((x) => `'${x}'`).join(",")}]::uuid[]` : "NULL"})`);
  return Array.isArray(r) ? Object.fromEntries(r.map((x) => [x.item_id, x])) : r;
};

// Items: 1-3 live 20 days (old enough), 4 live 2 days (too soon), 5 ended, 6 another seller's,
// 7 at a different address, 8 with an open offer, 9 in a buyer's cart.
const DAY = 24;
for (const [n, h] of [[1, 20 * DAY], [2, 20 * DAY], [3, 20 * DAY], [4, 2 * DAY], [5, 30 * DAY], [7, 20 * DAY], [8, 20 * DAY], [9, 20 * DAY]]) {
  await db.exec(liveItemSql({ id: I(n), title: `Haul item ${n}`, liveHoursAgo: h }));
}
await db.exec(liveItemSql({ id: I(6), seller: SELLER2, title: "Other seller chair", liveHoursAgo: 20 * DAY }));
await svc(`UPDATE public.declutter_items SET status = 'ended' WHERE id = '${I(5)}'`);
await svc(`UPDATE public.declutter_item_private SET pickup_address = '99 Other Rd, Baton Rouge, LA 70808' WHERE item_id = '${I(7)}'`);
await svc(`INSERT INTO public.declutter_item_photos (item_id, seller_id, storage_path, position)
  VALUES ('${I(1)}', '${SELLER}', '${SELLER}/declutter/${I(1)}/a.jpg', 0), ('${I(1)}', '${SELLER}', '${SELLER}/declutter/${I(1)}/b.jpg', 1),
         ('${I(2)}', '${SELLER}', '${SELLER}/declutter/${I(2)}/a.jpg', 0), ('${I(2)}', '${SELLER}', '${SELLER}/declutter/${I(2)}/b.jpg', 1),
         ('${I(2)}', '${SELLER}', '${SELLER}/declutter/${I(2)}/c.jpg', 2)`);
const offer = await me(BUYER, `SELECT public.declutter_make_offer('${I(8)}', 3000) AS id`);
const buy = await me(BUYER, `SELECT public.declutter_buy_now('${I(9)}', 4000) AS r`);
ok(Array.isArray(offer) && Array.isArray(buy), "setup: an open offer on item 8, item 9 in the buyer's cart");

// ---------------------------------------------------------------------------
// A. The switch and who may call.
ok(one(await svc(`SELECT audience FROM public.feature_switches WHERE key = 'declutter_haul_away'`)) === "testers",
  "the switch 'declutter_haul_away' is created for testers only");
ok(refused(await me(OUTSIDER, `SELECT * FROM public.declutter_haul_away_state()`), /feature_disabled/),
  "an ordinary (non-tester) account is refused the state read (feature_disabled)");
await job(90, OUTSIDER);
ok(refused(await link(OUTSIDER, [I(1)], J(90)), /feature_disabled/), "an ordinary account is refused the link (feature_disabled)");
ok(refused(await me(OUTSIDER, `SELECT public.declutter_cancel_haul_away('${I(1)}', NULL)`), /feature_disabled/),
  "an ordinary account is refused the undo (feature_disabled)");
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter_haul_away'`);
ok(refused(await me(SELLER, `SELECT * FROM public.declutter_haul_away_state()`), /feature_disabled/),
  "switch off: even a tester is refused");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter_haul_away'`);
for (const fn of ["declutter_haul_away_state(uuid[])", "declutter_link_haul_away(uuid[], uuid)", "declutter_cancel_haul_away(uuid, uuid)"]) {
  ok(one(await svc(`SELECT has_function_privilege('anon', 'public.${fn}', 'EXECUTE')`)) === false, `anon cannot call ${fn.split("(")[0]}`);
}
ok(refused(await me(SELLER, `SELECT * FROM public.declutter_haul_aways`), /permission denied/),
  "no client role reads the link table directly");

// ---------------------------------------------------------------------------
// B. State.
const s = await state(SELLER);
ok(s[I(1)]?.state === "eligible" && s[I(5)]?.state === "eligible", "live 20 days and off-sale items can be hauled");
ok(s[I(4)]?.state === "too_soon", "an item live 2 days is too soon (14-day default)");
ok(!s[I(9)] && (await state(SELLER, [I(9)]))[I(9)]?.state === "in_sale",
  "an item in a buyer's cart is left out of the list, and asked for by id reads 'in_sale'");
ok(!s[I(6)], "another seller's item is not listed");
ok(s[I(1)]?.pickup_group === s[I(2)]?.pickup_group && s[I(1)]?.pickup_group !== s[I(7)]?.pickup_group,
  "items at the same address share a pickup group; another address does not");
ok(s[I(1)]?.photo_paths?.length === 2, "the listing's photos come back in order for the job");
ok(refused(await me(SELLER, `SELECT * FROM public.declutter_haul_away_state(ARRAY['${I(6)}']::uuid[])`), /item_not_found/),
  "asking for someone else's item by id: item_not_found (not told it exists)");

// ---------------------------------------------------------------------------
// C. Link.
await job(1, SELLER);
await job(2, SELLER2);
ok(refused(await link(SELLER, [I(1)], J(2)), /haul_away_job_not_found/), "the job must be the caller's own");
ok(refused(await link(SELLER, [I(6)], J(1)), /item_not_found/), "someone else's item: item_not_found");
ok(refused(await link(SELLER, [I(4)], J(1)), /haul_away_too_soon/), "too soon: refused");
ok(refused(await link(SELLER, [I(9)], J(1)), /haul_away_in_sale/), "an item in a cart: refused");
ok(refused(await link(SELLER, [I(1), I(7)], J(1)), /haul_away_addresses_differ/), "two pickup addresses in one trip: refused");
ok(refused(await link(SELLER, Array.from({ length: 11 }, (_, k) => I(100 + k)), J(1)), /haul_away_too_many/), "11 items: refused");
ok(refused(await link(BANNED, [I(1)], J(1)), /account_restricted/), "a banned account is refused");
ok(await itemStatus(I(1)) === "live", "a refused link leaves the item on sale");
ok(one(await link(SELLER, [I(1), I(2), I(8)], J(1))) === 3, "three unsold items link to one job");
ok(await itemStatus(I(1)) === "ended" && await itemStatus(I(8)) === "ended", "linked items are off sale");
ok(one(await svc(`SELECT status FROM public.declutter_offers WHERE item_id = '${I(8)}'`)) === "voided",
  "the open offer on a hauled item is closed");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'Item off sale'`)) === 1,
  "the buyer is told their offer closed");
ok(refused(await me(BUYER, `SELECT public.declutter_make_offer('${I(1)}', 3000)`), /item_not_found|item_not_available/),
  "nobody can buy an item waiting to be hauled");
ok(one(await link(SELLER, [I(1), I(2), I(8)], J(1))) === 3, "a retry of the same post is a no-op");
await job(3, SELLER);
ok(refused(await link(SELLER, [I(3)], J(1)), /haul_away_job_taken/), "a job already hauling other items cannot take more");
ok((await state(SELLER, [I(1)]))[I(1)]?.state === "unpaid", "never-paid job, no checkout yet: state 'unpaid'");

// D. Money in flight (lh-money-escrow + lh-authz-rls reviews 2026-10-16). Job 1 holds items 1, 2, 8.
const cancel = (uid, item, j) => me(uid, `SELECT public.declutter_cancel_haul_away('${item}'${j ? `, '${j}'` : ""}) AS s`);
const setJob = (n, sql) => svc(`UPDATE public.jobs SET ${sql} WHERE id = '${J(n)}'`);
await job(3, SELLER);
await setJob(1, `stripe_session_id = 'cs_live_open'`);
ok((await state(SELLER, [I(1)]))[I(1)]?.state === "paying", "checkout open on job 1: state 'paying'");
ok(refused(await cancel(SELLER, I(1)), /haul_away_checkout_open/), "P2: no 'put back on sale' while a checkout can still be paid");
ok(refused(await link(SELLER, [I(1)], J(3)), /haul_away_checkout_open/), "P3: no re-point to a new job while the old checkout is open");
await setJob(1, `stripe_session_id = NULL`);
ok((await state(SELLER, [I(1)]))[I(1)]?.state === "unpaid", "checkout ran out: state 'unpaid'");
ok(refused(await cancel(SELLER, I(1)), /haul_away_job_open/), "an open never-paid job could still be paid later: undo refused until it is deleted");
ok(refused(await link(SELLER, [I(1)], J(3)), /haul_away_job_open/), "and re-point refused too");
await setJob(1, `payment_status = 'failed', stripe_session_id = 'cs_declined'`);
ok(refused(await cancel(SELLER, I(1)), /haul_away_checkout_open/), "declined card, session still open: the buyer may retry the card there, refused");
await setJob(1, `payment_status = 'abandoned', stripe_session_id = 'cs_dead'`);
ok(refused(await cancel(SELLER, I(1)), /haul_away_job_open/), "abandoned (session known dead): job_open, not paying forever");
ok((await me(SELLER, `SELECT job_hold FROM public.declutter_haul_away_state(ARRAY['${I(1)}']::uuid[])`))[0]?.job_hold === "job_open",
  "the state read hands the app the job's hold (it deletes only a job_open job)");
await setJob(1, `payment_status = 'failed', stripe_session_id = NULL`);
ok((await me(SELLER, `SELECT job_hold FROM public.declutter_haul_away_state(ARRAY['${I(1)}']::uuid[])`))[0]?.job_hold === "job_open",
  "declined card, session expired: job_open (no checkout can complete)");
ok((await me(SELLER, `DELETE FROM public.jobs WHERE id = '${J(1)}' RETURNING id`)).length === 0,
  "and the poster's own delete matches nothing (residual, filed)");
await setJob(1, `payment_status = 'unpaid', stripe_session_id = NULL`);
ok(Array.isArray(await me(SELLER, `DELETE FROM public.jobs WHERE id = '${J(1)}' RETURNING id`)), "the seller deletes the never-paid job under RLS (poster DELETE policy)");
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_haul_aways WHERE job_id IS NULL`)) === 3,
  "the seller's delete keeps the links with no job (ON DELETE SET NULL, real path)");
ok(one(await link(SELLER, [I(1)], J(3))) === 1, "job gone: the item may be booked again (re-pointed)");
ok(refused(await link(SELLER, [I(2)], J(3)), /haul_away_job_taken/), "job 3 hauls item 1 only");
await setJob(3, `payment_status = 'escrow'`);
ok((await state(SELLER, [I(1)]))[I(1)]?.state === "booked", "paid job: state 'booked'");
await job(4, SELLER);
ok(refused(await link(SELLER, [I(1)], J(4)), /haul_away_already_booked/), "a booked item cannot be linked to another job");
ok(refused(await cancel(SELLER, I(1)), /haul_away_already_booked/), "a paid haul-away cannot be undone here");
for (const st of ["cancelling", "chargeback", "payout_pending", "refunded"]) {
  await setJob(3, `payment_status = '${st}'`);
  ok(refused(await cancel(SELLER, I(1)), /haul_away_already_booked/), `P1: '${st}' on a live job counts as booked (fail closed)`);
}
await setJob(3, `status = 'completed', payment_status = 'released'`);
ok((await state(SELLER, [I(1)]))[I(1)]?.state === "hauled", "done job: state 'hauled'");
await setJob(3, `payment_status = 'chargeback'`);
ok(refused(await cancel(SELLER, I(1)), /haul_away_already_booked/), "P1: a hauled item never comes back on sale, even after a chargeback");
await job(5, SELLER, "escrow");
await db.exec(liveItemSql({ id: I(20), title: "Haul item 20", liveHoursAgo: 20 * DAY }));
ok(refused(await link(SELLER, [I(20)], J(5)), /haul_away_job_not_found/), "P5: an already-paid job cannot take a haul-away link");

// E. Undo.
ok(one(await cancel(SELLER, I(2))) === "live", "undo item 2 (its job was deleted, 3 photos): back on sale");
ok(await itemStatus(I(2)) === "live", "item 2 is live again");
ok(refused(await cancel(SELLER2, I(8)), /item_not_found/), "a stranger is told item_not_found");
ok(one(await link(SELLER, [I(5)], J(4))) === 1, "an off-sale (ended) item links");
ok(one(await cancel(SELLER, I(5), J(3))) === "ended", "Post a Job's undo for ANOTHER job leaves this link alone");
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_haul_aways WHERE item_id = '${I(5)}'`)) === 1, "the link to job 4 is still there");
await svc(`DELETE FROM public.jobs WHERE id = '${J(4)}'`);
ok(one(await cancel(SELLER, I(5), J(4))) === "ended", "Post a Job's own undo after deleting its job: restores 'ended', the prior status");
// P4: link, take down (photos removed), undo -> stays off sale.
await db.exec(liveItemSql({ id: I(21), title: "Haul item 21", liveHoursAgo: 20 * DAY }));
await svc(`INSERT INTO public.declutter_item_photos (item_id, seller_id, storage_path, position)
  SELECT '${I(21)}', '${SELLER}', '${SELLER}/declutter/${I(21)}/' || g || '.jpg', g FROM generate_series(0, 2) g`);
await job(6, SELLER);
ok(one(await link(SELLER, [I(21)], J(6))) === 1, "item 21 (3 photos) linked");
await svc(`DELETE FROM public.jobs WHERE id = '${J(6)}'`);
await me(SELLER, `SELECT public.declutter_withdraw_item('${I(21)}')`);
ok(one(await cancel(SELLER, I(21))) === "ended" && await itemStatus(I(21)) === "ended",
  "P4: taken down meanwhile (photos gone): undo leaves it off sale, never live with 0 photos");
await svc(`UPDATE public.jobs SET status = 'cancelled', payment_status = 'refunded' WHERE id = '${J(3)}'`);
ok((await state(SELLER, [I(1)]))[I(1)]?.state === "unpaid", "a cancelled, refunded haul-away job reads 'unpaid' (book again / put back)");
ok((await me(SELLER, `SELECT job_hold FROM public.declutter_haul_away_state(ARRAY['${I(1)}']::uuid[])`))[0]?.job_hold === "none",
  "and its hold is 'none': the app goes straight to undo, never deleting the cancelled job");
ok(one(await cancel(SELLER, I(1))) === "ended", "after the job is cancelled the link may go; no photos on item 1, so it stays off sale");
ok(refused(await cancel(SELLER, I(1)), /haul_away_not_found/), "nothing left to undo");
ok(one(await svc(`SELECT has_function_privilege('authenticated', 'public.declutter_haul_job_hold(uuid)', 'EXECUTE')`)) === false,
  "the hold helper is service-only");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

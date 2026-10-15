#!/usr/bin/env node
/**
 * Declutter slice 4: the CONCURRENT half of the handover/payout proof (CLAUDE.md
 * race rules: fresh order per round, Promise.allSettled, invariants read after).
 * Same machinery as scripts/declutter/race-accept.mjs: a real throwaway
 * PostgreSQL 17 (embedded-postgres in ~/.lh-embedded-pg, never a dependency;
 * data dir under ~/.lh-shots, deleted at the end), prod-shaped setup from
 * scripts/declutter/slice3Harness.mjs, slices 3/3b/cap/F1/4 each applied 3x.
 *
 *   node scripts/declutter/race-handover.mjs                       # GREEN: every invariant holds
 *   MIGRATION_PATH=<planted slice-4 copy> node scripts/declutter/race-handover.mjs   # RED on a planted race
 *   ROUNDS=<n> node scripts/declutter/race-handover.mjs            (default 20)
 *
 * Races (each round on a fresh paid, booked order; two real sessions at once):
 *   I  seller scans the QR while the buyer taps "I got it"   -> one handover, one payout
 *   J  seller scans while the 24 h auto-pay sweep runs        -> one handover, one payout
 *   K  buyer taps "I got it" while reporting a problem        -> handed over XOR problem open (never both, never paid with a problem)
 *   L  the seller scans twice at once (two phones)            -> one handover, one payout
 *   M  the auto-pay sweep runs twice at once                  -> one payout
 *   N  buyer reports a seller no-show while the seller scans  -> refunded XOR handed over (never a refund AND a payout)
 *   O  porch: the buyer's "Picked up" photo (pays at once, row 99) while the seller reports a problem
 *                                                             -> handed over XOR problem open (never paid with a problem)
 */
import os from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE } from "./slice3Harness.mjs";

const PG_DIR = process.env.EMBEDDED_PG_DIR ?? `${os.homedir()}/.lh-embedded-pg`;
const { default: EmbeddedPostgres } = await import(`${PG_DIR}/node_modules/embedded-postgres/dist/index.js`);
const { default: pg } = await import(`${PG_DIR}/node_modules/pg/lib/index.js`);
const ROUNDS = Number(process.env.ROUNDS ?? 20);
const PORT = Number(process.env.PGPORT_RACE ?? 54331);
const dataDir = `${os.homedir()}/.lh-shots/declutter-4/race-pgdata-${process.pid}`;
mkdirSync(`${os.homedir()}/.lh-shots/declutter-4`, { recursive: true });
const { SELLER, BUYER } = USERS;

const server = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "race", port: PORT, persistent: false, onLog: () => {} });
let failures = 0;
const results = {};
try {
  await server.initialise();
  await server.start();
  await server.createDatabase("race");
  const conn = () => new pg.Client({ host: "127.0.0.1", port: PORT, user: "postgres", password: "race", database: "race" });
  const admin = conn();
  await admin.connect();
  const slice4 = process.env.MIGRATION_PATH ? { path: process.env.MIGRATION_PATH, times: 3 } : { file: SLICE4_FILE, times: 3 };
  for (const sql of setupStatements({ times: 3, times3b: 3, extra: [{ file: FEE_F1_FILE, times: 3 }, slice4] })) await admin.query(sql);
  await admin.query(`CREATE OR REPLACE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN RAISE WARNING 'cron defect % % %', a, b, c; END $f$;`);
  await admin.query(CARDS_SQL);
  await admin.query(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
    SELECT $1::uuid, d, '09:00', '18:00' FROM generate_series(0, 6) d ON CONFLICT DO NOTHING`, [SELLER]);

  async function session(uid) {
    const c = conn();
    await c.connect();
    if (uid) {
      await c.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);
      await c.query(`SET ROLE authenticated`);
    }
    return c;
  }
  const S = { seller: await session(SELLER), seller2: await session(SELLER), buyer: await session(BUYER), buyer2: await session(BUYER),
              svcA: await session(null), svcB: await session(null) };
  const q1 = async (c, sql, args) => (await c.query(sql, args)).rows[0];
  const n = async (sql, args) => Number((await q1(admin, sql, args)).n);
  const tally = (race, ok, detail) => {
    results[race] ??= { rounds: 0, bad: 0, outcomes: {} };
    results[race].rounds++;
    if (!ok) { results[race].bad++; failures++; }
    results[race].outcomes[detail] = (results[race].outcomes[detail] ?? 0) + 1;
  };
  const res = (s) => (s.status === "fulfilled" ? (s.value.rows[0]?.r?.result ?? "ok") : (s.reason?.message ?? "err").split(/\s/)[0]);
  const outcome = (settled) => settled.map(res).sort().join("+");
  const tomorrowNoon = `((date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '1 day 12 hours') AT TIME ZONE 'America/Chicago')`;

  /** A fresh paid, booked order for SELLER/BUYER; returns { id, code }. `ago` (minutes) moves the slot into the past. */
  async function paidBooked(race, r, ago, handover = "pickup_home") {
    const item = `66666666-${race.charCodeAt(0).toString(16).padStart(4, "0")}-0000-0000-${String(r).padStart(12, "0")}`;
    await admin.query(liveItemSql({ id: item, title: `Race ${race} ${r}`, price: 2000, floor: 100 }));
    await S.buyer.query(`SELECT public.declutter_buy_now($1, 2000)`, [item]);
    const o = await q1(S.buyer, `SELECT * FROM public.declutter_start_checkout($1, $2)`, [SELLER, handover]);
    await admin.query(`SELECT public.declutter_mark_order_paid($1, $2, $3, now(), 88)`, [o.order_id, `pi_R${race}${r}`, o.total_cents]);
    await S.buyer.query(`SELECT public.declutter_book_pickup($1, ${tomorrowNoon})`, [o.order_id]);
    if (ago) {
      await admin.query(`UPDATE public.declutter_bookings SET slot_start = now() - make_interval(mins => $2),
        slot_end = now() - make_interval(mins => $2) + interval '30 minutes' WHERE order_id = $1`, [o.order_id, ago]);
    }
    const code = (await q1(admin, `SELECT code FROM public.declutter_handovers WHERE order_id = $1`, [o.order_id])).code;
    return { id: o.order_id, code };
  }
  const state = async (id) => ({
    status: (await q1(admin, `SELECT status FROM public.declutter_orders WHERE id = $1`, [id])).status,
    payouts: await n(`SELECT count(*) AS n FROM public.declutter_payouts WHERE order_id = $1`, [id]),
    refunds: await n(`SELECT count(*) AS n FROM public.declutter_refunds WHERE order_id = $1`, [id]),
    open: await n(`SELECT count(*) AS n FROM public.declutter_problems WHERE order_id = $1 AND status = 'open'`, [id]),
  });
  const scan = (c, o) => c.query(`SELECT public.declutter_confirm_handover($1, 'scan', $2) AS r`, [o.id, o.code]);
  const gotIt = (c, o) => c.query(`SELECT public.declutter_confirm_handover($1, 'buyer', NULL) AS r`, [o.id]);
  const sweep = (c) => c.query(`SELECT public.declutter_handover_sweep() AS r`);
  const handedOnce = (s) => s.status === "handed_over" && s.payouts === 1 && s.refunds === 0;

  for (let r = 0; r < ROUNDS; r++) {
    { // I
      const o = await paidBooked("I", r);
      const st = await Promise.allSettled([scan(S.seller, o), gotIt(S.buyer, o)]);
      const s = await state(o.id);
      tally("I", handedOnce(s) && outcome(st) === "already_handed_over+handed_over", `${outcome(st)} payouts=${s.payouts}`);
    }
    { // J
      const o = await paidBooked("J", r, 60 * 24 + 5);
      const st = r % 2 ? await Promise.allSettled([scan(S.seller, o), sweep(S.svcA)]) : await Promise.allSettled([sweep(S.svcA), scan(S.seller, o)]);
      const s = await state(o.id);
      tally("J", handedOnce(s), `${outcome(st)} payouts=${s.payouts}`);
    }
    { // K
      const o = await paidBooked("K", r);
      const st = await Promise.allSettled([gotIt(S.buyer, o),
        S.buyer2.query(`SELECT public.declutter_report_problem($1, 'damaged', 'Scratched top', NULL) AS r`, [o.id])]);
      const s = await state(o.id);
      const handed = handedOnce(s) && s.open === 0;
      const held = s.status === "paid" && s.payouts === 0 && s.open === 1;
      tally("K", handed !== held, `${outcome(st)} status=${s.status} open=${s.open} payouts=${s.payouts}`);
    }
    { // L
      const o = await paidBooked("L", r);
      const st = await Promise.allSettled([scan(S.seller, o), scan(S.seller2, o)]);
      const s = await state(o.id);
      tally("L", handedOnce(s), `${outcome(st)} payouts=${s.payouts}`);
    }
    { // M
      const o = await paidBooked("M", r, 60 * 24 + 5);
      const st = await Promise.allSettled([sweep(S.svcA), sweep(S.svcB)]);
      const s = await state(o.id);
      tally("M", handedOnce(s), `${outcome(st)} payouts=${s.payouts}`);
    }
    { // N
      const o = await paidBooked("N", r, 20);
      const st = await Promise.allSettled([scan(S.seller, o), S.buyer.query(`SELECT public.declutter_report_no_show($1) AS r`, [o.id])]);
      const s = await state(o.id);
      const refunded = s.status === "refunded" && s.refunds === 1 && s.payouts === 0;
      tally("N", handedOnce(s) !== refunded, `${outcome(st)} status=${s.status} refunds=${s.refunds} payouts=${s.payouts}`);
      // Seller strikes from N would block later rounds at 3.
      await admin.query(`DELETE FROM public.declutter_strikes WHERE user_id = $1`, [SELLER]);
    }
    { // O
      const o = await paidBooked("O", r, 10, "porch");
      const path = `${BUYER}/declutter/handover/${o.id}/got.jpg`;
      await admin.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('job-photos', $1)`, [path]);
      const st = await Promise.allSettled([
        S.buyer.query(`SELECT public.declutter_porch_photo($1, $2, 30.4513, -91.1543) AS r`, [o.id, path]),
        S.seller.query(`SELECT public.declutter_report_problem($1, 'other', 'Not sure it was picked up', NULL) AS r`, [o.id])]);
      const s = await state(o.id);
      const handed = handedOnce(s) && s.open === 0;
      const held = s.status === "paid" && s.payouts === 0 && s.open === 1;
      tally("O", handed !== held, `${outcome(st)} status=${s.status} open=${s.open} payouts=${s.payouts}`);
    }
  }
  for (const c of Object.values(S)) await c.end();
  await admin.end();
} catch (e) {
  failures++;
  console.error("SETUP/RUN ERROR:", e.message ?? e);
} finally {
  try { await server.stop(); } catch { /* already stopped: nothing to clean (logged below) */ console.error("server stop failed"); }
  rmSync(dataDir, { recursive: true, force: true });
}
for (const [race, r] of Object.entries(results)) {
  console.log(`${r.bad === 0 ? "PASS" : "FAIL"}  race ${race}: ${r.rounds - r.bad}/${r.rounds} rounds kept the invariant  ${JSON.stringify(r.outcomes)}`);
}
console.log(failures === 0 ? "\nALL RACES SAFE" : `\n${failures} INVARIANT BREAK(S)`);
process.exit(failures === 0 ? 0 : 1);

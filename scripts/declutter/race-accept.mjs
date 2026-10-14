#!/usr/bin/env node
/**
 * Declutter slice 3: the CONCURRENT half of the race proof (CLAUDE.md race
 * rules: fresh item per round, Promise.allSettled, invariants read after).
 * PGlite runs one session, so this uses a real throwaway PostgreSQL 17
 * (embedded-postgres, installed OUTSIDE the repo in ~/.lh-embedded-pg, never a
 * dependency; data dir under ~/.lh-shots, deleted at the end). Same prod-shaped
 * setup as the PGlite proof (scripts/declutter/slice3Harness.mjs).
 *
 *   node scripts/declutter/race-accept.mjs                 # GREEN: every invariant holds
 *   MIGRATION_PATH=<planted copy> node scripts/declutter/race-accept.mjs   # RED on a planted race
 *   ROUNDS=<n> node scripts/declutter/race-accept.mjs   (default 20 rounds per race, 2026-10-14)
 *
 * Races (each round on a fresh item, two real sessions at once):
 *   A  seller accepts two different buyers' offers at once  -> exactly one sale
 *   B  two buyers press Buy at once                         -> exactly one sale
 *   C  seller accepts an offer while another buyer Buys     -> exactly one sale
 *   D  webhook marks the order paid while the deadline sweep misses it
 *                                       -> paid XOR missed (never a paid line with a strike)
 *   E  the same payment webhook delivered twice at once     -> one 'paid', one 'already_paid'
 *   F  the buyer starts checkout twice at once              -> one payable order
 */
import os from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS } from "./slice3Harness.mjs";

const PG_DIR = process.env.EMBEDDED_PG_DIR ?? `${os.homedir()}/.lh-embedded-pg`;
const { default: EmbeddedPostgres } = await import(`${PG_DIR}/node_modules/embedded-postgres/dist/index.js`);
const { default: pg } = await import(`${PG_DIR}/node_modules/pg/lib/index.js`);
const ROUNDS = Number(process.env.ROUNDS ?? 20);
const PORT = Number(process.env.PGPORT_RACE ?? 54329);
const dataDir = `${os.homedir()}/.lh-shots/declutter-3/race-pgdata-${process.pid}`;
mkdirSync(`${os.homedir()}/.lh-shots/declutter-3`, { recursive: true });
const { SELLER, BUYER, BUYER2, BUYER3 } = USERS;

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
  for (const sql of setupStatements({ times: 3, slice3Path: process.env.MIGRATION_PATH })) await admin.query(sql);
  await admin.query(CARDS_SQL);

  /** A session acting as `uid` (role authenticated), or the service (uid null). */
  async function session(uid) {
    const c = conn();
    await c.connect();
    if (uid) {
      await c.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);
      await c.query(`SET ROLE authenticated`);
    }
    return c;
  }
  const S = { seller: await session(SELLER), b1: await session(BUYER), b2: await session(BUYER2), b3: await session(BUYER3),
              svcA: await session(null), svcB: await session(null) };
  const q1 = async (c, sql, args) => (await c.query(sql, args)).rows[0];
  const item = (r, race) => `33333333-${race.charCodeAt(0).toString(16).padStart(4, "0")}-0000-0000-${String(r).padStart(12, "0")}`;
  const sales = async (id) => Number((await q1(admin, `SELECT count(*) AS n FROM public.declutter_cart_items WHERE item_id = $1`, [id])).n);
  const accepted = async (id) => Number((await q1(admin, `SELECT count(*) AS n FROM public.declutter_offers WHERE item_id = $1 AND status = 'accepted'`, [id])).n);
  const tally = (race, ok, detail) => {
    results[race] ??= { rounds: 0, bad: 0, outcomes: {} };
    results[race].rounds++;
    if (!ok) { results[race].bad++; failures++; }
    results[race].outcomes[detail] = (results[race].outcomes[detail] ?? 0) + 1;
  };
  const outcome = (settled) => settled.map((s) => (s.status === "fulfilled" ? "ok" : (s.reason?.message ?? "err").split(/\s/)[0])).sort().join("+");

  for (let r = 0; r < ROUNDS; r++) {
    // A: two offers accepted at once by the seller.
    {
      const id = item(r, "A");
      await admin.query(liveItemSql({ id, title: `Race A ${r}` }));
      const o1 = (await q1(S.b1, `SELECT public.declutter_make_offer($1, 3000) AS id`, [id])).id;
      const o2 = (await q1(S.b2, `SELECT public.declutter_make_offer($1, 3100) AS id`, [id])).id;
      const seller2 = await session(SELLER);
      const st = await Promise.allSettled([
        S.seller.query(`SELECT public.declutter_respond_offer($1, 'accept', NULL)`, [o1]),
        seller2.query(`SELECT public.declutter_respond_offer($1, 'accept', NULL)`, [o2]),
      ]);
      await seller2.end();
      const n = await sales(id);
      const a = await accepted(id);
      tally("A", n === 1 && a === 1, `${outcome(st)} sales=${n} accepted=${a}`);
    }
    // B: two buyers press Buy at once.
    {
      const id = item(r, "B");
      await admin.query(liveItemSql({ id, title: `Race B ${r}` }));
      const st = await Promise.allSettled([
        S.b1.query(`SELECT public.declutter_buy_now($1, 4000)`, [id]),
        S.b2.query(`SELECT public.declutter_buy_now($1, 4000)`, [id]),
      ]);
      const n = await sales(id);
      tally("B", n === 1, `${outcome(st)} sales=${n}`);
    }
    // C: accept an offer while another buyer Buys.
    {
      const id = item(r, "C");
      await admin.query(liveItemSql({ id, title: `Race C ${r}` }));
      const o = (await q1(S.b1, `SELECT public.declutter_make_offer($1, 3000) AS id`, [id])).id;
      const st = await Promise.allSettled([
        S.seller.query(`SELECT public.declutter_respond_offer($1, 'accept', NULL)`, [o]),
        S.b3.query(`SELECT public.declutter_buy_now($1, 4000)`, [id]),
      ]);
      const n = await sales(id);
      const offerAccepted = await accepted(id);
      const buyLine = Number((await q1(admin, `SELECT count(*) AS n FROM public.declutter_cart_items WHERE item_id = $1 AND source = 'buy'`, [id])).n);
      tally("C", n === 1 && offerAccepted + buyLine === 1, `${outcome(st)} sales=${n}`);
    }
    // D: paid vs missed. A line past its deadline + grace, its order still awaiting payment.
    {
      const id = item(r, "D");
      await admin.query(liveItemSql({ id, seller: USERS.SELLER2, title: `Race D ${r}` }));
      await S.b2.query(`SELECT public.declutter_buy_now($1, 4000)`, [id]);
      const order = await q1(S.b2, `SELECT * FROM public.declutter_start_checkout($1, 'porch')`, [USERS.SELLER2]);
      await admin.query(`UPDATE public.declutter_cart_items SET checkout_by = now() - interval '61 minutes' WHERE item_id = $1`, [id]);
      const strikesBefore = Number((await q1(admin, `SELECT count(*) AS n FROM public.declutter_strikes WHERE user_id = $1`, [BUYER2])).n);
      // Alternate who is sent first, so both orders are exercised.
      const mark = () => S.svcA.query(`SELECT public.declutter_mark_order_paid($1, $2, $3) AS r`, [order.order_id, `pi_D${r}`, order.total_cents]);
      const sweep = () => S.svcB.query(`SELECT public.declutter_deadline_sweep()`);
      const st = r % 2 === 0 ? await Promise.allSettled([mark(), sweep()]) : (await Promise.allSettled([sweep(), mark()])).reverse();
      const paidRes = st[0].status === "fulfilled" ? st[0].value.rows[0].r : "error";
      const line = await q1(admin, `SELECT c.status AS line, i.status AS item, o.status AS ord FROM public.declutter_cart_items c
        JOIN public.declutter_items i ON i.id = c.item_id JOIN public.declutter_orders o ON o.id = $2 WHERE c.item_id = $1`, [id, order.order_id]);
      const struck = Number((await q1(admin, `SELECT count(*) AS n FROM public.declutter_strikes WHERE user_id = $1`, [BUYER2])).n) - strikesBefore;
      const consistent =
        (paidRes === "paid" && line.line === "paid" && line.item === "sold" && line.ord === "paid" && struck === 0)
        || (paidRes === "refund_in_full" && line.line === "missed" && line.item === "live" && line.ord === "expired" && struck === 1);
      tally("D", consistent, `mark=${paidRes} line=${line.line} strikes+${struck}`);
      // Clear BUYER2's strikes so 3 never block later rounds.
      await admin.query(`DELETE FROM public.declutter_strikes WHERE user_id = $1`, [BUYER2]);
    }
    // E: the same webhook twice at once.
    {
      const id = item(r, "E");
      await admin.query(liveItemSql({ id, seller: USERS.SELLER2, title: `Race E ${r}` }));
      await S.b3.query(`SELECT public.declutter_buy_now($1, 4000)`, [id]);
      const order = await q1(S.b3, `SELECT * FROM public.declutter_start_checkout($1, 'porch')`, [USERS.SELLER2]);
      const st = await Promise.allSettled([
        S.svcA.query(`SELECT public.declutter_mark_order_paid($1, $2, $3) AS r`, [order.order_id, `pi_E${r}`, order.total_cents]),
        S.svcB.query(`SELECT public.declutter_mark_order_paid($1, $2, $3) AS r`, [order.order_id, `pi_E${r}`, order.total_cents]),
      ]);
      const rs = st.map((s) => (s.status === "fulfilled" ? s.value.rows[0].r : "error")).sort().join("+");
      tally("E", rs === "already_paid+paid", rs);
    }
    // F: checkout started twice at once.
    {
      const id = item(r, "F");
      await admin.query(liveItemSql({ id, seller: USERS.SELLER2, title: `Race F ${r}` }));
      await S.b1.query(`SELECT public.declutter_buy_now($1, 4000)`, [id]);
      const b1b = await session(BUYER);
      const st = await Promise.allSettled([
        S.b1.query(`SELECT * FROM public.declutter_start_checkout($1, 'porch')`, [USERS.SELLER2]),
        b1b.query(`SELECT * FROM public.declutter_start_checkout($1, 'pickup_home')`, [USERS.SELLER2]),
      ]);
      await b1b.end();
      const awaiting = Number((await q1(admin, `SELECT count(*) AS n FROM public.declutter_orders WHERE buyer_id = $1 AND seller_id = $2 AND status = 'awaiting_payment'`, [BUYER, USERS.SELLER2])).n);
      const linesInAwaiting = Number((await q1(admin, `SELECT count(*) AS n FROM public.declutter_cart_items c JOIN public.declutter_orders o ON o.id = c.order_id
        WHERE c.item_id = $1 AND o.status = 'awaiting_payment'`, [id])).n);
      tally("F", awaiting === 1 && linesInAwaiting === 1, `${outcome(st)} awaiting=${awaiting}`);
      // Pay it so the next round starts with an empty cart for this pair.
      const o = await q1(admin, `SELECT id, total_cents FROM public.declutter_orders WHERE buyer_id = $1 AND seller_id = $2 AND status = 'awaiting_payment'`, [BUYER, USERS.SELLER2]);
      if (o) await admin.query(`SELECT public.declutter_mark_order_paid($1, $2, $3)`, [o.id, `pi_F${r}`, o.total_cents]);
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

#!/usr/bin/env node
/**
 * PGlite proof for 20261028014848_helpr_task_tips (Q2453: tips on Declutter deliveries).
 *
 *   node src/test/pglite/helprTaskTips.pglite.mjs                    # after (3x replay): all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/helprTaskTips.pglite.mjs # before: RED
 *   MUTANT=<name> node src/test/pglite/helprTaskTips.pglite.mjs      # a planted defect: RED
 *
 * Owner #3706 (option 2): a Helpr with no payout account still gets the tip, HELD with their held
 * delivery pay: proven here from the start (held), the notice (set up payouts), the payout queue
 * (helpr_task_payouts_due's tip_parts, the REAL newest body) and the record of the sent transfer.
 *
 * World: the REAL helpr_tasks and helpr_task_payouts tables (20261017055505, verbatim), the REAL helpr_task_rows_seed,
 * declutter_notify and member_display_name (newest definitions), profiles and notifications with
 * the columns they read. Stubbed, and said so, each from a table so every refusal can be driven:
 * is_caller_banned, helpr_task_source_require_feature (the 'declutter' switch), are_users_blocked,
 * helpr_task_source_held and declutter_order_refunds_recorded_cents (not what these checks drive), and the
 * declutter_orders / declutter_delivery_raises columns helpr_task_payouts_due reads.
 * The money (the card fee on top, the Helpr's whole tip) is NOT here: it lives only in
 * supabase/functions/_shared/tipFees.ts and is proven by src/test/edge/declutter-delivery-tip.test.ts.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const THIS = "20261028014848_helpr_task_tips.sql";
const BASE = "20261017055505_declutter_helpr_delivery.sql";
const MUTANT = process.env.MUTANT ?? "";
const skip = process.env.NEW_MIGRATION === "skip";

function newest(name, before = THIS) {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (FILES[i] >= before) continue;
    const src = readFileSync(MIG_DIR + FILES[i], "utf8");
    const start = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))[1];
    const open = src.indexOf(tag, start);
    return src.slice(start, src.indexOf(tag, open + tag.length) + tag.length) + ";";
  }
  throw new Error(`${name}: no definition before ${before}`);
}
function table(file, name) {
  const src = readFileSync(MIG_DIR + file, "utf8");
  const start = src.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`);
  return src.slice(start, src.indexOf("\n);", start) + 3);
}

const MUTANTS = {
  // Anyone may tip any delivery (the buyer check is gone).
  buyer: ["  IF NOT FOUND OR t.customer_id IS DISTINCT FROM v_uid THEN", "  IF NOT FOUND THEN"],
  // A delivery not yet done takes a tip.
  done: ["  IF t.status <> 'confirmed' THEN", "  IF t.status NOT IN ('confirmed', 'delivered', 'accepted', 'picked_up') THEN"],
  // The Helpr is told twice on a replayed webhook.
  once: ["  IF r.payment_status = 'paid' THEN\n    RETURN jsonb_build_object('result', 'already'", "  IF false THEN\n    RETURN jsonb_build_object('result', 'already'"],
  // Members read every tip.
  rls: ["USING (tipper_id = (SELECT auth.uid()) OR helpr_id = (SELECT auth.uid()))", "USING (true)"],
  // A member can mark a tip paid.
  grant: ["REVOKE ALL ON FUNCTION public.helpr_task_tip_paid(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;", "GRANT EXECUTE ON FUNCTION public.helpr_task_tip_paid(uuid, text, text, integer) TO authenticated;"],
  // A page is re-pointed after it was attached.
  attach: ["   WHERE id = p_tip_id AND payment_status = 'pending' AND stripe_session_id IS NULL;", "   WHERE id = p_tip_id AND payment_status = 'pending';"],
  // The switch is not asked.
  switch: ["  PERFORM public.helpr_task_source_require_feature(t.source_kind);\n  IF t.status <> 'confirmed'", "  IF t.status <> 'confirmed'"],
  // A blocked Helpr can be tipped.
  blocked: [" OR public.are_users_blocked(v_uid, t.helpr_id) THEN", " THEN"],
  // Owner #3706: a Helpr with no payout account is never held (the tip would go nowhere).
  held: ["  v_held := NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = t.helpr_id AND pr.stripe_account_id IS NOT NULL);",
         "  v_held := false;"],
  // A held tip already sent is queued again (paid twice).
  twice: ["WHERE x.task_id = t.id AND x.held AND x.payment_status = 'paid' AND x.payout_transfer_id IS NULL), '[]'::jsonb)",
          "WHERE x.task_id = t.id AND x.held AND x.payment_status = 'paid'), '[]'::jsonb)"],
  // A held tip whose payout went without it is never listed for staff (stranded silently).
  stranded: ["     AND (p.id IS NULL OR p.status NOT IN ('pending', 'failed', 'held_for_review')", "     AND (p.id IS NULL"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };

const U = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const BUYER = U(1), SELLER = U(2), HELPR = U(3), STRANGER = U(4), BANNED = U(5), OFF = U(6), ENEMY = U(7), SEEDBUYER = U(8), NEWHELPR = U(9);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  grant usage on schema auth, public to anon, authenticated, service_role;
  create table public.profiles (user_id uuid primary key, full_name text, is_seed boolean default false, stripe_account_id text);
  create table public.declutter_orders (id uuid primary key, stripe_payment_intent_id text);
  create table public.declutter_delivery_raises (id uuid primary key, task_id uuid, status text, stripe_payment_intent_id text, raise_cents int, applied_at timestamptz);
  create function public.declutter_order_refunds_recorded_cents(p uuid) returns integer language sql stable as $f$ select 0 $f$;
  create function public.helpr_task_source_held(p_kind text, p_source uuid) returns boolean language sql stable as $f$ select false $f$;
  create table public.notifications (id bigint generated always as identity, user_id uuid, type text, title text, message text, link text);
  create table public.banned (user_id uuid primary key);
  create function public.is_caller_banned() returns boolean language sql stable as
    $f$ select exists (select 1 from public.banned where user_id = auth.uid()) $f$;
  create table public.switch_off (user_id uuid primary key);
  create function public.helpr_task_source_require_feature(p_kind text) returns void language plpgsql as $f$
  begin
    if exists (select 1 from public.switch_off where user_id = auth.uid()) then raise exception 'feature_disabled' using errcode = '42501'; end if;
  end $f$;
  create table public.blocks (a uuid, b uuid);
  create function public.are_users_blocked(p1 uuid, p2 uuid) returns boolean language sql stable as
    $f$ select exists (select 1 from public.blocks where (a = p1 and b = p2) or (a = p2 and b = p1)) $f$;
`);
await db.exec(table(BASE, "helpr_tasks"));
await db.exec(`ALTER TABLE public.helpr_tasks ADD COLUMN IF NOT EXISTS raised_cents integer NOT NULL DEFAULT 0;`);
await db.exec(table(BASE, "helpr_task_payouts"));
// 20261019070737's statuses (held_for_review, settled_by_hand), as on prod.
await db.exec(`ALTER TABLE public.helpr_task_payouts DROP CONSTRAINT IF EXISTS helpr_task_payouts_status_check;
  ALTER TABLE public.helpr_task_payouts ADD CONSTRAINT helpr_task_payouts_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due', 'held_for_review', 'settled_by_hand'));`);
for (const fn of ["helpr_task_rows_seed", "declutter_notify", "member_display_name"]) await db.exec(newest(fn));
if (!skip) for (let i = 0; i < 3; i++) await db.exec(mig); // replay-safe: applied three times

const people = [BUYER, SELLER, HELPR, STRANGER, BANNED, OFF, ENEMY, SEEDBUYER, NEWHELPR];
await db.exec(`insert into auth.users values ${people.map((u) => `('${u}')`).join(",")}`);
await db.exec(`insert into public.profiles (user_id, full_name, is_seed) values
  ('${BUYER}', 'Pat Lemoine', false), ('${SELLER}', 'Sam Seller', false), ('${HELPR}', 'Hank Helpr', false), ('${STRANGER}', 'Stu Ranger', false),
  ('${BANNED}', 'Ban Ned', false), ('${OFF}', 'Off Switch', false), ('${ENEMY}', 'En Emy', false), ('${SEEDBUYER}', 'Seed Buyer', true),
  ('${NEWHELPR}', 'Nia Newhelpr', false)`);
// HELPR has a payout account; NEWHELPR has none yet (owner #3706: their tip is held with their delivery pay).
await db.exec(`update public.profiles set stripe_account_id = 'acct_hank' where user_id = '${HELPR}'`);
await db.exec(`insert into public.banned values ('${BANNED}'); insert into public.switch_off values ('${OFF}');`);

let n = 0;
async function task(o) {
  const id = `bbbbbbbb-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  const st = o.status ?? "confirmed";
  const taken = ["accepted", "picked_up", "delivered", "confirmed"].includes(st);
  await db.query(`insert into public.helpr_tasks (id, source_kind, source_id, status, size, title, pickup_area, dropoff_area, pickup_address, pickup_lat, pickup_lng,
      dropoff_address, dropoff_lat, dropoff_lng, trip_miles, pay_cents, fee_cents, customer_id, pickup_contact_id, helpr_id, open_until, latest_pickup_at,
      pickup_slot_start, accepted_at, picked_up_at, pickup_photo_path, delivered_at, dropoff_photo_path, confirmed_at, confirmed_by, dropoff_code, is_seed)
    values ($1, 'declutter_delivery', $1, $2, 'small', 'Oak dresser', 'Mid City', 'Shenandoah', '1 Seller St', 30.45, -91.15, '1 Buyer Ln', 30.40, -91.05,
      6, 2500, 195, $3, $4, $5, now() + interval '1 day', now() + interval '3 days', $6, $6, $7, $8, $9, $10, $11, $12, '1234', $13)`,
    [id, st, o.customer ?? BUYER, SELLER, taken ? (o.helpr === undefined ? HELPR : o.helpr) : null,
     taken ? new Date(Date.now() - 86_400_000).toISOString() : null,
     ["picked_up", "delivered", "confirmed"].includes(st) ? new Date().toISOString() : null,
     ["picked_up", "delivered", "confirmed"].includes(st) ? `${HELPR}/task/${id}/p.jpg` : null,
     ["delivered", "confirmed"].includes(st) ? new Date().toISOString() : null,
     ["delivered", "confirmed"].includes(st) ? `${HELPR}/task/${id}/d.jpg` : null,
     st === "confirmed" ? new Date().toISOString() : null, st === "confirmed" ? "customer" : null, o.seed ?? false]);
  return id;
}
async function as(uid, sql, params = []) {
  try {
    await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); SET ROLE ${uid ? "authenticated" : "anon"};`);
    return { ok: true, rows: (await db.query(sql, params)).rows };
  } catch (e) {
    return { ok: false, code: String(e.message) };
  } finally {
    await db.exec(`RESET ROLE; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
const svc = async (sql, params = []) => {
  try { await db.exec("SET ROLE service_role"); return { ok: true, rows: (await db.query(sql, params)).rows }; }
  catch (e) { return { ok: false, code: String(e.message) }; }
  finally { await db.exec("RESET ROLE"); }
};
const A1 = "cccccccc-0000-0000-0000-000000000001", A2 = "cccccccc-0000-0000-0000-000000000002";
const start = (uid, t, cents = 1000, attempt = A1) => as(uid, "select public.helpr_task_tip_start($1, $2, $3) as r", [t, cents, attempt]);
const refused = (r, re) => !r.ok && re.test(r.code);

const DONE = await task({});
const s1 = await start(BUYER, DONE);
check(s1.ok && s1.rows[0].r.tip_id && s1.rows[0].r.helpr_id === HELPR && s1.rows[0].r.tip_cents === 1000 && s1.rows[0].r.payment_status === "pending",
  `[start] the buyer of a done delivery starts a $10 tip for its Helpr${s1.ok ? "" : ` (${s1.code})`}`);
const tipId = s1.ok ? s1.rows[0].r.tip_id : null;
const s2 = await start(BUYER, DONE);
check(s2.ok && s2.rows[0].r.tip_id === tipId, "[start] a retry of the same prompt (attempt, amount) reuses its row");
const s3 = await start(BUYER, DONE, 1500);
check(s3.ok && s3.rows[0].r.tip_id !== tipId, "[start] another amount is another row (as a job tip: another Stripe page)");
for (const [who, uid] of [["the seller", SELLER], ["the Helpr", HELPR], ["a stranger", STRANGER]]) {
  check(refused(await start(uid, DONE), /task_not_found/), `[who] ${who} cannot tip this delivery (task_not_found)`);
}
check(refused(await start(null, DONE), /permission denied|not_authenticated/), "[who] signed out: refused");
for (const st of ["open", "accepted", "picked_up", "delivered", "cancelled", "failed", "unfilled"]) {
  const t = await task({ status: st });
  check(refused(await start(BUYER, t), /tip_not_yet/), `[done] a delivery that is ${st} takes no tip yet`);
}
check(refused(await start(BANNED, await task({ customer: BANNED })), /account_restricted/), "[who] a banned buyer cannot tip");
check(refused(await start(OFF, await task({ customer: OFF })), /feature_disabled/), "[switch] the 'declutter' switch off: refused");
for (const [cents, attempt, why] of [[299, A1, "under $3"], [100001, A1, "over $1,000"], [null, A1, "no amount"], [1000, null, "no attempt id"]]) {
  check(refused(await start(BUYER, DONE, cents, attempt), /invalid_tip/), `[amount] ${why}: invalid_tip`);
}
await db.exec(`insert into public.blocks values ('${ENEMY}', '${HELPR}')`);
check(refused(await start(ENEMY, await task({ customer: ENEMY })), /tip_unavailable/), "[blocked] a buyer and Helpr who blocked each other: no tip");
check(refused(await start(BUYER, await task({ helpr: null, status: "cancelled" })), /tip_not_yet/), "[gone] a closed delivery with no Helpr: no tip");

// The ledger is read only by its two people, and written by no member.
const mine = await as(BUYER, "select count(*)::int c from public.helpr_task_tips");
const theirs = await as(HELPR, "select count(*)::int c from public.helpr_task_tips");
const other = await as(STRANGER, "select count(*)::int c from public.helpr_task_tips");
check(mine.ok && mine.rows[0].c === 2 && theirs.ok && theirs.rows[0].c === 2 && other.ok && other.rows[0].c === 0,
  `[read] the tipper and the Helpr read their tips; a stranger reads none (${mine.rows?.[0]?.c}/${theirs.rows?.[0]?.c}/${other.rows?.[0]?.c})`);
check(!(await as(BUYER, `update public.helpr_task_tips set payment_status = 'paid', paid_at = now(), charged_cents = 1100 where id = '${tipId}'`)).ok
  || (await db.query(`select payment_status from public.helpr_task_tips where id = '${tipId}'`)).rows[0].payment_status === "pending",
  "[write] a member cannot mark a tip paid by writing the table");
check(!(await as(BUYER, `insert into public.helpr_task_tips (task_id, tipper_id, helpr_id, tip_cents, attempt_id) values ('${DONE}', '${BUYER}', '${HELPR}', 500, '${A2}')`)).ok,
  "[write] a member cannot insert a tip row");
check(refused(await as(BUYER, "select public.helpr_task_tip_paid($1, 'cs_x', 'pi_x', 1100)", [tipId]), /permission denied/), "[write] a member cannot call helpr_task_tip_paid");
check(refused(await as(BUYER, "select public.helpr_task_tip_attach($1, 'cs_x')", [tipId]), /permission denied/), "[write] a member cannot call helpr_task_tip_attach");
check(refused(await as(null, "select public.helpr_task_tip_start($1, 1000, $2)", [DONE, A1]), /permission denied/), "[grant] anon cannot call helpr_task_tip_start");

// The page: attached once; paid once; the Helpr told once, by name and amount.
const at1 = await svc("select public.helpr_task_tip_attach($1, 'cs_test_1') as r", [tipId]);
const at2 = await svc("select public.helpr_task_tip_attach($1, 'cs_test_2') as r", [tipId]);
check(at1.ok && at1.rows[0].r === true && at2.ok && at2.rows[0].r === false, "[attach] a row keeps the first page it was given");
const mis = await svc("select public.helpr_task_tip_paid($1, 'cs_test_2', 'pi_2', 1066) as r", [tipId]);
check(mis.ok && mis.rows[0].r.result === "session_mismatch", "[paid] another page cannot mark this row paid");
const p1 = await svc("select public.helpr_task_tip_paid($1, 'cs_test_1', 'pi_1', 1066) as r", [tipId]);
check(p1.ok && p1.rows[0].r.result === "paid" && p1.rows[0].r.helpr_id === HELPR, `[paid] the paid page marks the row paid${p1.ok ? "" : ` (${p1.code})`}`);
const row = (await db.query(`select * from public.helpr_task_tips where id = '${tipId}'`)).rows[0];
check(row?.payment_status === "paid" && row.stripe_payment_intent_id === "pi_1" && row.charged_cents === 1066 && row.paid_at, "[paid] the PaymentIntent and what Stripe charged are kept");
const p2 = await svc("select public.helpr_task_tip_paid($1, 'cs_test_1', 'pi_1', 1066) as r", [tipId]);
check(p2.ok && p2.rows[0].r.result === "already", "[paid] a replayed webhook answers 'already'");
const notes = (await db.query(`select user_id, type, title, message, link from public.notifications`)).rows;
check(notes.length === 1 && notes[0].user_id === HELPR && notes[0].type === "payment" && notes[0].link === "/declutter?view=deliver"
  && notes[0].message === "Pat L. tipped you $10.00 for a delivery. Thanks for the great work!",
  `[told] the Helpr is told once, who and how much (${notes.map((x) => x.message).join(" | ")})`);
check(!/fee/i.test(notes.map((x) => `${x.title} ${x.message}`).join(" ")), "[told] the notice names no fee");
const unk = await svc("select public.helpr_task_tip_paid('dddddddd-0000-0000-0000-000000000001', 'cs_x', 'pi_x', 1066) as r");
check(unk.ok && unk.rows[0].r.result === "unknown", "[paid] an unknown tip id answers 'unknown'");

// Owner #3706: a Helpr with no payout account yet. Their delivery pay waits (pending); the tip is taken and held.
const NEWTASK = await task({ helpr: NEWHELPR });
await db.exec(`insert into public.declutter_orders values ('${NEWTASK}', 'pi_order_new')`);
const noPayoutRow = await start(BUYER, NEWTASK, 1000, A1);
check(refused(noPayoutRow, /tip_unavailable/), "[held] no waiting delivery pay to hold the tip with: no tip (staff would have nothing to send it with)");
await db.exec(`insert into public.helpr_task_payouts (task_id, helpr_id, pay_cents, fee_cents, amount_cents, status) values ('${NEWTASK}', '${NEWHELPR}', 2500, 195, 2305, 'pending')`);
const h1 = await start(BUYER, NEWTASK, 1000, A1);
check(h1.ok && h1.rows[0].r.held === true, `[held] a Helpr with no payout account: the tip is taken and marked held${h1.ok ? "" : ` (${h1.code})`}`);
check(s1.ok && s1.rows[0].r.held === false, "[held] a Helpr with a payout account: not held (the job tip's destination charge)");
const heldId = h1.ok ? h1.rows[0].r.tip_id : null;
await svc("select public.helpr_task_tip_attach($1, 'cs_test_h') as r", [heldId]);
const hp = await svc("select public.helpr_task_tip_paid($1, 'cs_test_h', 'pi_tip_h', 1061) as r", [heldId]);
check(hp.ok && hp.rows[0].r.result === "paid" && hp.rows[0].r.held === true && hp.rows[0].r.attached === true, "[held] paid, held, and its delivery pay is waiting (attached)");
const hn = (await db.query(`select message from public.notifications where user_id = '${NEWHELPR}'`)).rows;
check(hn.length === 1 && hn[0].message === "Pat L. tipped you $10.00 for a delivery. Set up payouts in Settings to get it with your delivery pay.",
  `[held] the Helpr is told who tipped and to set up payouts (${hn.map((x) => x.message).join(" | ")})`);
const due = async () => (await svc("select payout_id, amount_cents, tip_parts from public.helpr_task_payouts_due(50) where task_id = $1", [NEWTASK]));
const d1 = await due();
check(d1.ok && d1.rows.length === 1 && d1.rows[0].amount_cents === 2305
  && d1.rows[0].tip_parts.length === 1 && d1.rows[0].tip_parts[0].tip_id === heldId
  && d1.rows[0].tip_parts[0].payment_intent_id === "pi_tip_h" && d1.rows[0].tip_parts[0].cents === 1000,
  `[queue] the payout queue names the held tip beside the delivery pay, exactly the tip, from the tip's own charge (${JSON.stringify(d1.rows?.[0]?.tip_parts ?? d1.code)})`);
check(refused(await as(NEWHELPR, "select public.helpr_task_tip_payout_sent($1, 'tr_x')", [heldId]), /permission denied/), "[sent] a member cannot record a tip as sent");
const ps1 = await svc("select public.helpr_task_tip_payout_sent($1, 'tr_tip_h') as r", [heldId]);
const ps2 = await svc("select public.helpr_task_tip_payout_sent($1, 'tr_tip_h') as r", [heldId]);
const ps3 = await svc("select public.helpr_task_tip_payout_sent($1, 'tr_other') as r", [heldId]);
check(ps1.rows?.[0]?.r === "recorded" && ps2.rows?.[0]?.r === "already" && ps3.rows?.[0]?.r === "mismatch", "[sent] the tip's transfer is recorded once; a replay is 'already', another transfer is refused");
const ps4 = await svc("select public.helpr_task_tip_payout_sent($1, 'tr_not_held') as r", [tipId]);
check(ps4.rows?.[0]?.r === "mismatch", "[sent] a tip that was not held (already the Helpr's) is never recorded as sent");
const d2 = await due();
check(d2.ok && d2.rows.length === 1 && JSON.stringify(d2.rows[0].tip_parts) === "[]", "[queue] once sent, the tip leaves the queue (never sent twice)");
const sentNote = (await db.query(`select message from public.notifications where user_id = '${NEWHELPR}' order by id desc limit 1`)).rows[0];
check(sentNote?.message === "Your $10.00 delivery tip is on its way to your payout account.", "[sent] the Helpr is told the tip is on its way");
// The delivery pay already went (or was settled by hand) between the page opening and the payment: staff pay the tip.
const h2 = await start(BUYER, NEWTASK, 1500, A2);
await db.exec(`update public.helpr_task_payouts set status = 'settled_by_hand' where task_id = '${NEWTASK}'`);
const hp2 = await svc("select public.helpr_task_tip_paid($1, null, 'pi_tip_h2', 1576) as r", [h2.ok ? h2.rows[0].r.tip_id : null]);
check(hp2.ok && hp2.rows[0].r.held === true && hp2.rows[0].r.attached === false, "[held] a held tip whose delivery pay no longer waits answers attached=false (the webhook pages staff)");
const lastNote = (await db.query(`select message from public.notifications where user_id = '${NEWHELPR}' order by id desc limit 1`)).rows[0];
check(lastNote?.message === "Pat L. tipped you $15.00 for a delivery. We will send it to you.", `[held] ...and the Helpr is not promised it comes with the delivery pay (${lastNote?.message})`);
// lh-money-escrow review must-fix 1: every held, paid, unsent tip whose payout no longer waits is listed for staff.
const stranded = async () => ((await svc("select tip_id, payout_status from public.helpr_task_tips_stranded()")).rows ?? []);
const s1r = await stranded();
check(s1r.length === 1 && s1r[0].tip_id === (h2.ok ? h2.rows[0].r.tip_id : null) && s1r[0].payout_status === "settled_by_hand",
  `[stranded] a held tip whose delivery pay was settled by hand is listed for staff (the sent one is not) (${JSON.stringify(s1r)})`);
await db.exec(`update public.helpr_task_payouts set status = 'pending' where task_id = '${NEWTASK}'`);
check((await stranded()).length === 0, "[stranded] while the delivery pay still waits, nothing is listed (it goes with it)");
await db.exec(`update public.helpr_task_payouts set status = 'failed', attempts = 12 where task_id = '${NEWTASK}'`);
check((await stranded()).length === 1, "[stranded] a delivery payout that gave up (12 tries) lists its held tip");
await db.exec(`update public.helpr_task_payouts set status = 'succeeded', stripe_transfer_id = 'tr_pay', attempts = 1 where task_id = '${NEWTASK}'`);
check((await stranded()).length === 1, "[stranded] a delivery payout that went WITHOUT the tip lists it");
check(refused(await as(NEWHELPR, "select * from public.helpr_task_tips_stranded()"), /permission denied/), "[stranded] members cannot read the staff list");

// A seed delivery's tip is seed.
const SEEDTASK = await task({ customer: SEEDBUYER, seed: true });
const ss = await start(SEEDBUYER, SEEDTASK);
const seedRow = ss.ok ? (await db.query(`select is_seed from public.helpr_task_tips where id = '${ss.rows[0].r.tip_id}'`)).rows[0] : null;
check(seedRow?.is_seed === true, "[seed] a tip on a seed delivery is seed");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);

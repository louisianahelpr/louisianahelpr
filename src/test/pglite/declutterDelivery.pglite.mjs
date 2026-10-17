#!/usr/bin/env node
/**
 * PGlite proof for 20261017052705_declutter_helpr_delivery (Declutter slice 5,
 * Helpr delivery: spec rows 24, 27, 29-30, 38, 40-43, B59-B72), on top of
 * slices 1-4, the $1,000 cap, F1, porch default (20261017052704), lane J's
 * refund hand-settle (20261017052700) and private handover bucket
 * (20261017052702). The new migration is applied 3 times.
 *
 *   node src/test/pglite/declutterDelivery.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterDelivery.pglite.mjs  # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterDelivery.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite. Storage is
 * not Supabase's here: the bucket policy logic is proven, not the Storage API.
 */
import os from "node:os";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const NEW_FILE = "20261017052705_declutter_helpr_delivery.sql";
const BEFORE = [
  "20261017052700_declutter_refund_hand_settle.sql",
  "20261017052702_declutter_handover_private_bucket.sql",
  "20261017052704_declutter_porch_default.sql",
];
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, SELLER2, BUYER, BUYER2, BUYER3, OUTSIDER, MINOR, BANNED, NOPAYOUT, ADMIN, NOCARD } = USERS;
const HELPR = BUYER2;   // has a payout account, 18+, a tester
const HELPR2 = BUYER3;
const skip = process.env.NEW_MIGRATION === "skip";

const db = new PGlite();
// Live shapes the migration and its callees touch that the harness does not create.
await db.exec(`CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]);
  INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', true);`);
const extra = [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 }, ...BEFORE.map((file) => ({ file, times: 1 }))];
if (!skip) extra.push(process.env.MIGRATION_PATH ? { path: process.env.MIGRATION_PATH, times: 3 } : { file: NEW_FILE, times: 3 });
const stmts = setupStatements({ times: 1, times3b: 1, extra });
// Stubs for the jobs strike ladder and the cron defect log (their real bodies
// need half the jobs schema); they record what they were asked.
stmts.splice(1, 0, `
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
  CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    violation_type text NOT NULL, description text, job_id uuid, action_taken text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.cron_defects_seen (fn text, ref text, msg text);
  CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text) RETURNS void LANGUAGE sql
    AS $$ INSERT INTO public.cron_defects_seen VALUES (p_fn, p_ref, p_msg) $$;`);
stmts.splice(2, 0, `
  CREATE OR REPLACE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text,
    p_job_id uuid, p_prior_count int, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean,
    p_suspension_days int, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
  BEGIN
    INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken)
    VALUES (p_user, p_violation_type, p_description, p_job_id, p_rungs[least(p_prior_count, array_length(p_rungs, 1) - 1) + 1]);
    RETURN jsonb_build_object('action', p_rungs[least(p_prior_count, array_length(p_rungs, 1) - 1) + 1]);
  END $$;
  REVOKE ALL ON FUNCTION public.apply_consequence_ladder(uuid, text, text, uuid, int, text[], text[], jsonb, boolean, int, boolean, text, text) FROM PUBLIC, anon, authenticated;`);
for (const sql of stmts) await db.exec(sql);
await db.exec(CARDS_SQL);
await db.exec(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT s, d, '00:00', '23:59' FROM unnest(ARRAY['${SELLER}', '${SELLER2}']::uuid[]) s, generate_series(0, 6) d;`);

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
async function anon(sql) {
  try {
    await db.exec(`SET ROLE anon;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE;`);
  }
}
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const I = (n) => `88888888-0000-0000-0000-${String(n).padStart(12, "0")}`;
// The pickup point every fixture item has (slice3Harness.liveItemSql).
const PICK = { lat: 30.451234, lng: -91.154321 };
// A drop-off ~5 km north (0.045 deg lat ~ 5.0 km = 3.11 mi; x1.3 = 4.05 -> 5 road miles).
const DROP = { lat: 30.496234, lng: -91.154321 };
const item = async (n, seller, price, size = "large") => {
  await db.exec(liveItemSql({ id: I(n), seller, title: `Delivery item ${n}`, price, floor: Math.min(price, 100) }));
  await svc(`UPDATE public.declutter_items SET delivery_size = '${size}' WHERE id = '${I(n)}'`);
};
const buy = (uid, n, cents) => me(uid, `SELECT public.declutter_buy_now('${I(n)}', ${cents})`);
const setDrop = (buyer, seller, p = DROP, addr = '500 Drop Rd, Baton Rouge, LA 70805') =>
  svc(`SELECT public.declutter_set_delivery_dropoff('${buyer}', '${seller}', '${addr}', 'North Baton Rouge', ${p.lat}, ${p.lng})`);
const checkout = (uid, seller, handover) => me(uid, `SELECT * FROM public.declutter_start_checkout('${seller}', '${handover}')`);
const markPaid = (o, tag) => svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_dl_${tag}', ${o.total_cents}, now(), 150)`);
const taskOf = async (orderId) => one(await svc(`SELECT task_id FROM public.declutter_order_deliveries WHERE order_id = '${orderId}'`));
const task = async (id) => (await svc(`SELECT * FROM public.helpr_tasks WHERE id = '${id}'`))[0];
const order = async (id) => (await svc(`SELECT * FROM public.declutter_orders WHERE id = '${id}'`))[0];
const slot = one(await svc(`SELECT (date_trunc('hour', now()) + interval '26 hours')::text`));
const photo = (uid, taskId, name) => svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('helpr-tasks', '${uid}/task/${taskId}/${name}')`);
const truck = async (uid, second = false) => {
  await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('helpr-tasks', '${uid}/vehicle/truck.jpg')`);
  return me(uid, `SELECT public.helpr_set_vehicle(true, ${second}, '${uid}/vehicle/truck.jpg')`);
};
const view = async (uid, taskId) => one(await me(uid, `SELECT public.helpr_task_view('${taskId}')`));

// Paid delivery order: one item, bought, drop-off stored, checked out, paid.
async function paidDelivery(n, buyer, seller, price, size = "large") {
  await item(n, seller, price, size);
  await buy(buyer, n, price);
  await setDrop(buyer, seller);
  const o = (await checkout(buyer, seller, "delivery"))[0];
  await markPaid(o, n);
  return { ...o, task: await taskOf(o.order_id) };
}

// 0. The migration is there (RED with NEW_MIGRATION=skip).
ok(one(await svc(`SELECT to_regclass('public.helpr_tasks')::text`)) === "helpr_tasks", "helpr_tasks exists");

// 1. Price (row 29) and road miles (B60).
ok(one(await svc(`SELECT public.declutter_delivery_price_cents(1, ARRAY['small'])`)) === 1200, "1 mile, small: $10 + $2 = $12");
ok(one(await svc(`SELECT public.declutter_delivery_price_cents(10, ARRAY['small','large','xl'])`)) === 1000 + 2000 + 2000 + 4000,
  "10 miles, small + large + extra large: $10 + $20 + $20 + $40 = $90 (one base + miles per checkout, size per item)");
ok(one(await svc(`SELECT public.declutter_road_miles(${PICK.lat}, ${PICK.lng}, ${DROP.lat}, ${DROP.lng})`)) === 5,
  "5.0 km straight line x 1.3, rounded up = 5 road miles");
ok(one(await svc(`SELECT public.declutter_road_miles(30, -91, 30, -91)`)) === 1, "the same point is still 1 mile (minimum)");
ok(one(await svc(`SELECT public.declutter_road_miles(30.45, -91.15, 32.5, -93.75)`)) > 250,
  "no distance limit (row 30): Baton Rouge to Shreveport is priced, not refused");
ok(one(await svc(`SELECT public.helpr_task_fee_cents(1000)`)) === 120 && one(await svc(`SELECT public.helpr_task_fee_cents(5)`)) === 5,
  "the Helpr's fee is jobs' flat 5% + 70c, never more than the pay (row 42)");
ok(one(await svc(`SELECT public.helpr_task_fee_cents(1010)`)) === 121, "a half cent rounds up, as the app's mirror does (1010 -> 121)");

// 2. Quote: needs a server-stored drop-off; the switch; one pickup address.
await item(1, SELLER, 5000);
await buy(BUYER, 1, 5000);
ok(refused(await me(BUYER, `SELECT public.declutter_delivery_quote('${SELLER}')`), /delivery_address_needed/),
  "no drop-off stored: the quote asks for an address");
ok(refused(await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'delivery')`), /delivery_address_needed/),
  "and checkout with delivery is refused");
ok(refused(await me(BUYER, `SELECT public.declutter_set_delivery_dropoff('${BUYER}', '${SELLER}', '1 Fake St, Nowhere', 'x', 0, 0)`), /permission denied/),
  "a member cannot store a drop-off point themself (only the edge function, which geocodes it)");
ok(refused(await me(BUYER, `INSERT INTO public.declutter_delivery_dropoffs (buyer_id, seller_id, address, area_label, lat, lng) VALUES ('${BUYER}', '${SELLER}', '1 Fake St', 'x', 30.45, -91.15)`), /permission denied/),
  "nor write the table");
await setDrop(BUYER, SELLER);
const q1 = one(await me(BUYER, `SELECT public.declutter_delivery_quote('${SELLER}')`));
ok(q1?.road_miles === 5 && q1?.delivery_cents === 1000 + 1000 + 2000 && q1?.size === "large",
  `quote: 5 miles, large = $10 + $10 + $20 = $40 (${JSON.stringify(q1)})`);
ok(q1 && !("dropoff_lat" in q1) && !("pickup_address" in q1), "the quote carries no coordinates or pickup address");
// lh-authz-rls #2: the quote is priced from the ROUNDED pickup point, so quoting chosen drop-offs cannot find the home.
{
  let probe = null;
  for (let k = 1; k < 400 && !probe; k++) {
    const lat = PICK.lat + k * 0.0005;
    const ex = one(await svc(`SELECT public.declutter_road_miles(${PICK.lat}, ${PICK.lng}, ${lat}, ${PICK.lng})`));
    const ro = one(await svc(`SELECT public.declutter_road_miles(30.45, -91.15, ${lat}, ${PICK.lng})`));
    if (ex !== ro) probe = { lat, ex, ro };
  }
  await setDrop(BUYER, SELLER, { lat: probe.lat, lng: PICK.lng });
  const qp = one(await me(BUYER, `SELECT public.declutter_delivery_quote('${SELLER}')`));
  ok(qp?.road_miles === probe.ro && probe.ro !== probe.ex,
    `the quote's miles come from the rounded pickup point (${qp?.road_miles}; rounded ${probe.ro}, exact ${probe.ex})`);
  await setDrop(BUYER, SELLER);
}
ok(refused(await me(OUTSIDER, `SELECT public.declutter_delivery_quote('${SELLER}')`), /feature_disabled/),
  "an account the switch is off for cannot quote (require_feature)");
ok(Array.isArray(await me(BUYER, `SELECT address FROM public.declutter_delivery_dropoffs`))
  && one(await me(BUYER, `SELECT count(*)::int FROM public.declutter_delivery_dropoffs`)) === 1
  && one(await me(SELLER, `SELECT count(*)::int FROM public.declutter_delivery_dropoffs`)) === 0,
  "the buyer reads their own drop-off address; the seller reads none");
ok(refused(await me(BUYER, `SELECT lat FROM public.declutter_delivery_dropoffs`), /permission denied/),
  "the stored coordinates have no client privilege");

// 3. Checkout with delivery: the fee frozen from server data, one payment.
const o1 = (await checkout(BUYER, SELLER, "delivery"))[0];
const r1 = await order(o1.order_id);
ok(r1?.handover === "delivery" && r1.delivery_cents === 4000 && r1.items_cents === 5000
  && r1.premium_cents === Math.round(5000 * 0.05) + 70 && r1.total_cents === 5000 + 320 + 4000,
  `the order: items $50 + buyer's fee $3.20 (on the items only) + delivery $40 = $93.20 (${r1?.total_cents})`);
ok(one(await svc(`SELECT road_miles FROM public.declutter_order_deliveries WHERE order_id = '${o1.order_id}'`)) === 5,
  "the drop-off and miles are frozen with the order");
const o1b = (await checkout(BUYER, SELLER, "delivery"))[0];
ok(o1b?.order_id === o1.order_id, "the same checkout again returns the same open order (idempotent)");
await setDrop(BUYER, SELLER, { lat: 30.541234, lng: -91.154321 }, '900 Far Rd, Baker, LA 70714');
const o1c = (await checkout(BUYER, SELLER, "delivery"))[0];
ok(o1c?.order_id !== o1.order_id && (await order(o1.order_id))?.status === "superseded"
  && (await order(o1c.order_id))?.delivery_cents > 4000,
  "a new drop-off address makes a new order with the new fee; the old one is superseded");
ok(refused(await svc(`UPDATE public.declutter_orders SET delivery_cents = 1000 WHERE id = '${o1c.order_id}'`), /order_amounts_frozen/),
  "the delivery fee is frozen after checkout");
ok(refused(await svc(`UPDATE public.declutter_orders SET handover = 'porch' WHERE id = '${o1c.order_id}'`), /order_handover_frozen/),
  "the handover is frozen too (only the paid no-Helpr fallback may change it)");
ok(refused(await svc(`UPDATE public.declutter_orders SET delivery_cents = 0 WHERE id = '${o1c.order_id}'`), /order_amounts_frozen|declutter_orders_delivery/),
  "a delivery order cannot lose its fee");
// Two items at two addresses: no delivery (B61).
await item(2, SELLER2, 2000, "small");
await item(3, SELLER2, 2000, "small");
await svc(`UPDATE public.declutter_item_private SET pickup_lat = 30.60, pickup_lng = -91.10 WHERE item_id = '${I(3)}'`);
await buy(BUYER, 2, 2000);
await buy(BUYER, 3, 2000);
await setDrop(BUYER, SELLER2);
ok(refused(await checkout(BUYER, SELLER2, "delivery"), /delivery_one_address/), "items at two addresses cannot be delivered together");
const oPick = await checkout(BUYER, SELLER2, "pickup_home");
ok(Array.isArray(oPick) && oPick[0]?.order_id, "the same cart checks out for pickup");
await markPaid(oPick[0], "pick");

// 4. Paid -> the Helpr task opens (row 42), money frozen on it.
await markPaid(o1c, "1c");
const t1 = await taskOf(o1c.order_id);
const T1 = await task(t1);
const r1c = await order(o1c.order_id);
ok(T1?.status === "open" && T1.pay_cents === r1c.delivery_cents && T1.fee_cents === Math.round(r1c.delivery_cents * 0.05) + 70
  && T1.customer_id === BUYER && T1.pickup_contact_id === SELLER && T1.size === "large",
  `paying opens one open task: pay = the delivery fee, fee = 5% + 70c (${T1?.pay_cents}/${T1?.fee_cents})`);
ok(one(await svc(`SELECT round(extract(epoch FROM (open_until - now())) / 3600)::int FROM public.helpr_tasks WHERE id = '${t1}'`)) === 48,
  "open for 48 hours (row 40)");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${SELLER}' AND title = 'A Helpr will pick it up'`)) >= 1,
  "the seller is told a Helpr will pick it up");
ok(refused(await me(BUYER, `SELECT * FROM public.helpr_tasks`), /permission denied/), "members have no privilege on helpr_tasks");
ok(refused(await me(HELPR, `SELECT public.helpr_task_create('declutter_delivery', gen_random_uuid(), 'small', 'x', 'a', 'a', 30, -91, 'b', 'b', 30, -91, 1, 1000, NULL, NULL, now(), now(), false)`), /permission denied/),
  "members cannot create tasks");
ok(refused(await me(BUYER, `SELECT public.declutter_book_pickup('${o1c.order_id}', '${slot}')`), /delivery_order/),
  "a delivery order has no buyer booking (the Helpr picks the time)");
ok(refused(await me(BUYER, `SELECT public.declutter_confirm_handover('${o1c.order_id}', 'buyer', NULL)`), /delivery_not_done/),
  "\"I got it\" before the Helpr has the item is refused (nobody is paid)");

// 5. Finding and taking it (rows 41, 42).
ok(one(await me(HELPR, `SELECT count(*)::int FROM public.helpr_tasks_open_near(${PICK.lat}, ${PICK.lng}, 50) WHERE task_id = '${t1}'`)) === 0,
  "a Helpr without a truck does not see a large delivery");
ok(refused(await me(HELPR, `SELECT public.helpr_task_accept('${t1}', '${slot}')`), /vehicle_too_small/), "nor can take it");
ok(refused(await me(HELPR, `SELECT public.helpr_set_vehicle(true, false, NULL)`), /vehicle_photo_required/), "a truck needs a photo");
ok(refused(await me(HELPR, `SELECT public.helpr_set_vehicle(true, false, '${HELPR}/vehicle/none.jpg')`), /vehicle_photo_required/),
  "a photo that was never uploaded is refused");
ok(refused(await me(HELPR, `SELECT public.helpr_set_vehicle(false, true, NULL)`), /invalid_vehicle/), "a second person needs a truck");
ok(refused(await me(HELPR, `SELECT public.helpr_set_vehicle(NULL, false, NULL)`), /invalid_vehicle/), "a NULL truck answer is refused, never stored");
const tr = await truck(HELPR);
ok(Array.isArray(tr), "with a truck photo the vehicle is saved");
const near = await me(HELPR, `SELECT * FROM public.helpr_tasks_open_near(${PICK.lat}, ${PICK.lng}, 50) WHERE task_id = '${t1}'`);
ok(Array.isArray(near) && near.length === 1 && near[0].take_home_cents === T1.pay_cents - T1.fee_cents && !("pickup_address" in near[0]),
  "now they see it: area words, miles and take-home pay, no address");
// lh-authz-rls #1: miles to the pickup are measured from the ROUNDED pickup point (~1 km), never the exact one.
{
  // A search point due north where the exact and the rounded distance fall on different whole miles.
  let probe = null;
  for (let k = 1; k < 400 && !probe; k++) {
    const lat = PICK.lat + k * 0.0005;
    const ex = Math.max(1, Math.ceil((lat - PICK.lat) * 111195 / 1609.344));
    const ro = Math.max(1, Math.ceil((lat - 30.45) * 111195 / 1609.344));
    if (ex !== ro) probe = lat;
  }
  const rounded = one(await svc(`SELECT greatest(1, ceil(public.helpr_task_distance_m(${probe}, ${PICK.lng}, 30.45, -91.15) / 1609.344))::int`));
  const exact = one(await svc(`SELECT greatest(1, ceil(public.helpr_task_distance_m(${probe}, ${PICK.lng}, ${PICK.lat}, ${PICK.lng}) / 1609.344))::int`));
  const seen = one(await me(HELPR, `SELECT miles_to_pickup FROM public.helpr_tasks_open_near(${probe}, ${PICK.lng}, 50) WHERE task_id = '${t1}'`));
  ok(probe !== null && rounded !== exact && seen === rounded,
    `a Helpr's miles to the pickup come from the rounded point, so they cannot trilaterate the home (${seen}; rounded ${rounded}, exact ${exact})`);
}
const cand = await view(HELPR, t1);
ok(cand?.role === "candidate" && cand.pickup_address === null && cand.dropoff_address === null && cand.dropoff_code === null,
  "an open task's view for a Helpr: no address, no code");
ok(refused(await me(OUTSIDER, `SELECT * FROM public.helpr_tasks_open_near(30, -91, 5)`), /feature_disabled/), "the switch gates finding tasks");
ok(refused(await me(MINOR, `SELECT * FROM public.helpr_tasks_open_near(30, -91, 5)`), /under_18/), "under 18 cannot deliver");
ok(refused(await me(NOPAYOUT, `SELECT * FROM public.helpr_tasks_open_near(30, -91, 5)`), /payout_setup_incomplete/), "payout setup comes first");
ok(refused(await me(BANNED, `SELECT public.helpr_task_accept('${t1}', '${slot}')`), /account_restricted/), "a banned account cannot take one");
await truck(SELLER);
ok(refused(await me(SELLER, `SELECT public.helpr_task_accept('${t1}', '${slot}')`), /own_task/), "the seller cannot deliver their own sale");
ok(refused(await me(HELPR, `SELECT public.helpr_task_accept('${t1}', now() - interval '1 hour')`), /invalid_slot/), "a past pickup time is refused");
ok(refused(await me(HELPR, `SELECT public.helpr_task_accept('${t1}', now() + interval '8 days')`), /invalid_slot/), "after the 7-day deadline is refused");
await svc(`DELETE FROM public.declutter_pickup_windows WHERE seller_id = '${SELLER}' AND weekday = extract(dow FROM ('${slot}'::timestamptz AT TIME ZONE 'America/Chicago'))`);
ok(refused(await me(HELPR, `SELECT public.helpr_task_accept('${t1}', '${slot}')`), /invalid_slot/), "outside the seller's pickup times is refused");
await svc(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local) SELECT '${SELLER}', d, '00:00', '23:59' FROM generate_series(0, 6) d ON CONFLICT DO NOTHING`);
const acc = one(await me(HELPR, `SELECT public.helpr_task_accept('${t1}', '${slot}')`));
ok(acc?.result === "accepted", "the Helpr takes it with a pickup time");
await truck(HELPR2);
ok(refused(await me(HELPR2, `SELECT public.helpr_task_accept('${t1}', '${slot}')`), /task_taken/), "a second Helpr cannot take it (first wins)");
const hv = await view(HELPR, t1);
ok(hv?.role === "helpr" && hv.pickup_address?.includes("Example St") && hv.dropoff_address === null && hv.dropoff_code === null,
  "the Helpr now reads the pickup address; not the drop-off yet, never the code");
const bv = await view(BUYER, t1);
ok(bv?.role === "customer" && /^[0-9]{4}$/.test(bv.dropoff_code ?? "") && bv.pickup_address === null && bv.dropoff_address === null,
  "the buyer reads their drop-off code, no addresses");
const sv = await view(SELLER, t1);
ok(sv?.role === "pickup_contact" && sv.dropoff_code === null && sv.dropoff_address === null, "the seller reads progress only");
ok(refused(await me(OUTSIDER, `SELECT public.helpr_task_view('${t1}')`), /task_not_found|feature_disabled/), "anyone else is told nothing");
ok(refused(await me(HELPR2, `SELECT public.helpr_task_view('${t1}')`), /task_not_found/), "another Helpr cannot read a taken task");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'A Helpr took your delivery'`)) === 1,
  "the buyer is told a Helpr took it");

// 6. Photos: the private bucket's rules (A5).
const W = (uid, name) => me(uid, `SELECT public.helpr_task_photo_access('${name}', true)`);
const R = (uid, name) => me(uid, `SELECT public.helpr_task_photo_access('${name}', false)`);
ok(one(await W(HELPR, `${HELPR}/task/${t1}/a.jpg`)) === true, "the assigned Helpr uploads into their own task folder");
ok(one(await W(HELPR2, `${HELPR2}/task/${t1}/a.jpg`)) === false, "another Helpr cannot");
ok(one(await W(BUYER, `${BUYER}/task/${t1}/a.jpg`)) === false, "the buyer cannot upload task photos");
ok(one(await W(HELPR, `${BUYER}/task/${t1}/a.jpg`)) === false, "nobody writes into another person's folder");
ok(one(await R(BUYER, `${HELPR}/task/${t1}/a.jpg`)) === true && one(await R(SELLER, `${HELPR}/task/${t1}/a.jpg`)) === true,
  "the buyer and the seller read the task's photos");
ok(one(await R(OUTSIDER, `${HELPR}/task/${t1}/a.jpg`)) === false, "an outsider cannot");
ok(one(await R(ADMIN, `${HELPR}/task/${t1}/a.jpg`)) === true, "an admin can");
ok(one(await R(BUYER, `${HELPR}/vehicle/truck.jpg`)) === false && one(await R(HELPR, `${HELPR}/vehicle/truck.jpg`)) === true,
  "a vehicle photo: the owner (and admins) only");
ok(one(await W(HELPR, `${HELPR}/task/${t1}/x/y.jpg`)) === false, "extra path segments are refused");
ok(one(await svc(`SELECT public FROM storage.buckets WHERE id = 'helpr-tasks'`)) === false, "the bucket is private");

// 7. Pickup.
ok(refused(await me(HELPR, `SELECT public.helpr_task_picked_up('${t1}', '${HELPR}/task/${t1}/p.jpg', ${PICK.lat}, ${PICK.lng})`), /photo_not_uploaded/),
  "\"Picked up\" needs an uploaded photo");
await photo(HELPR, t1, "p.jpg");
ok(refused(await me(HELPR, `SELECT public.helpr_task_picked_up('${t1}', '${HELPR}/task/${t1}/p.jpg', ${DROP.lat}, ${DROP.lng})`), /not_at_pickup/),
  "taken away from the pickup point it is refused");
ok(refused(await me(HELPR2, `SELECT public.helpr_task_picked_up('${t1}', '${HELPR}/task/${t1}/p.jpg', ${PICK.lat}, ${PICK.lng})`), /task_not_found/),
  "only the assigned Helpr");
ok(one(await me(HELPR, `SELECT public.helpr_task_picked_up('${t1}', '${HELPR}/task/${t1}/p.jpg', ${PICK.lat}, ${PICK.lng})`))?.result === "picked_up",
  "at the pickup point with a photo: picked up");
ok((await view(HELPR, t1))?.dropoff_address?.includes("Far Rd"), "now the Helpr reads the drop-off address");
ok(refused(await me(HELPR, `SELECT public.helpr_task_release('${t1}')`), /already_picked_up/), "a Helpr with the item cannot back out");
ok(refused(await me(SELLER, `SELECT public.declutter_report_no_show('${o1c.order_id}')`), /not_booked_yet/), "the booking no-show path does not apply");

// 8. Drop-off with the code (B65): seller and Helpr paid at once.
await photo(HELPR, t1, "d.jpg");
const code1 = (await view(BUYER, t1)).dropoff_code;
const wrong = code1 === "0000" ? "1111" : "0000";
const w1 = one(await me(HELPR, `SELECT public.helpr_task_delivered('${t1}', '${HELPR}/task/${t1}/d.jpg', ${DROP.lat + 0.045}, ${DROP.lng}, '${wrong}')`));
ok(w1?.result === "wrong_code" && w1.attempts_left === 4, "a wrong code is counted and returned (4 left)");
ok(refused(await me(HELPR, `SELECT public.helpr_task_delivered('${t1}', '${HELPR}/task/${t1}/p.jpg', ${30.541234}, ${-91.154321}, NULL)`), /photo_not_uploaded/),
  "the pickup photo cannot double as the drop-off photo");
ok(refused(await me(HELPR, `SELECT public.helpr_task_delivered('${t1}', '${HELPR}/task/${t1}/d.jpg', ${PICK.lat}, ${PICK.lng}, '${code1}')`), /not_at_dropoff/),
  "away from the drop-off point it is refused");
const d1raw = await me(HELPR, `SELECT public.helpr_task_delivered('${t1}', '${HELPR}/task/${t1}/d.jpg', 30.541234, -91.154321, '${code1}')`);
const d1 = one(d1raw);
if (!d1) console.log("drop-off:", JSON.stringify(d1raw));
const r1d = await order(o1c.order_id);
const T1d = await task(t1);
ok(d1?.result === "confirmed" && r1d.status === "handed_over" && T1d.status === "confirmed" && T1d.confirmed_by === "code",
  "with the buyer's code at the drop-off: confirmed, the order handed over");
const sp = (await svc(`SELECT * FROM public.declutter_payouts WHERE order_id = '${o1c.order_id}'`))[0];
const hp = (await svc(`SELECT * FROM public.helpr_task_payouts WHERE task_id = '${t1}'`))[0];
ok(sp?.amount_cents === 5000 && sp.status === "pending", "the seller is owed exactly the item price");
ok(hp?.amount_cents === T1.pay_cents - T1.fee_cents && hp.helpr_id === HELPR && hp.status === "pending",
  `the Helpr is owed the delivery fee minus 5% + 70c (${hp?.amount_cents})`);
const due = (await svc(`SELECT * FROM public.helpr_task_payouts_due(10) WHERE task_id = '${t1}'`))[0];
ok(due?.payment_intent_id === "pi_dl_1c" && due.transfer_group === `declutter_order_${o1c.order_id}` && due.refunds_recorded_cents === 0
  && due.stripe_account_id === "acct_2",
  "the Helpr payout is due from the order's own charge, in the order's transfer group");
ok(one(await me(HELPR, `SELECT count(*)::int FROM public.helpr_task_payouts`)) === 1 && one(await me(BUYER, `SELECT count(*)::int FROM public.helpr_task_payouts`)) === 0,
  "the Helpr reads their own payout; the buyer does not");
ok(one(await me(HELPR, `SELECT public.helpr_task_delivered('${t1}', '${HELPR}/task/${t1}/d.jpg', 30.541234, -91.154321, '${code1}')`))?.result === "already_confirmed",
  "a second drop-off tap changes nothing");
ok(one(await svc(`SELECT public.helpr_task_payout_executed('${hp.id}', 'tr_h1', true, NULL)`)) === "succeeded"
  && one(await svc(`SELECT count(*)::int FROM public.helpr_task_payouts_due(10) WHERE task_id = '${t1}'`)) === 0,
  "a sent Helpr payout is final and leaves the queue");
ok(refused(await svc(`SELECT public.helpr_task_payout_executed('${hp.id}', NULL, NULL, NULL)`), /invalid_result/), "a NULL result is refused");

// 9. Door drop-off + the buyer's "I got it"; and the day-long door rule with a problem open (2026-10-16).
const P2 = await paidDelivery(10, BUYER3, SELLER2, 3000, "small");
ok(P2.task && (await task(P2.task)).size === "small", "a small delivery");
ok(one(await me(HELPR, `SELECT count(*)::int FROM public.helpr_tasks_open_near(NULL, NULL, 50) WHERE task_id = '${P2.task}'`)) === 1,
  "a small delivery is offered to any Helpr");
await me(HELPR, `SELECT public.helpr_task_accept('${P2.task}', '${slot}')`);
await photo(HELPR, P2.task, "p.jpg");
await photo(HELPR, P2.task, "d.jpg");
await me(HELPR, `SELECT public.helpr_task_picked_up('${P2.task}', '${HELPR}/task/${P2.task}/p.jpg', ${PICK.lat}, ${PICK.lng})`);
const d2 = one(await me(HELPR, `SELECT public.helpr_task_delivered('${P2.task}', '${HELPR}/task/${P2.task}/d.jpg', ${DROP.lat}, ${DROP.lng}, NULL)`));
ok(d2?.result === "delivered" && (await order(P2.order_id)).status === "paid", "nobody home: left at the door, nobody paid yet");
const dn = async () => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${BUYER3}' AND title = 'Delivered'`));
const dnBefore = await dn();
ok(one(await me(HELPR, `SELECT public.helpr_task_delivered('${P2.task}', NULL, NULL, NULL, NULL)`))?.result === "delivered" && await dn() === dnBefore,
  "a repeat drop-off tap answers 'delivered' without sending the buyer the notice again (lh-silent-failure #5)");

ok(refused(await me(BUYER, `SELECT public.helpr_task_customer_confirm('${P2.task}')`), /task_not_found/), "only this delivery's buyer confirms it");
ok(one(await me(BUYER3, `SELECT public.helpr_task_customer_confirm('${P2.task}')`))?.result === "handed_over"
  && (await task(P2.task)).confirmed_by === "customer",
  "the buyer taps \"I got it\": seller and Helpr paid");

const P3 = await paidDelivery(11, BUYER3, SELLER, 3000, "small");
await me(HELPR, `SELECT public.helpr_task_accept('${P3.task}', '${slot}')`);
await photo(HELPR, P3.task, "p.jpg");
await photo(HELPR, P3.task, "d.jpg");
await me(HELPR, `SELECT public.helpr_task_picked_up('${P3.task}', '${HELPR}/task/${P3.task}/p.jpg', ${PICK.lat}, ${PICK.lng})`);
await me(HELPR, `SELECT public.helpr_task_delivered('${P3.task}', '${HELPR}/task/${P3.task}/d.jpg', ${DROP.lat}, ${DROP.lng}, NULL)`);
const prob3 = one(await me(BUYER3, `SELECT public.declutter_report_problem('${P3.order_id}', 'damaged', 'The leg is broken.', '{}')`));
ok(typeof prob3 === "string", "the buyer reports a problem after a door drop-off");
await svc(`UPDATE public.helpr_tasks SET delivered_at = now() - interval '25 hours' WHERE id = '${P3.task}'`);
await svc(`SELECT public.helpr_task_sweep()`);
ok((await task(P3.task)).status === "delivered" && (await order(P3.order_id)).status === "paid",
  "with a problem open the 24 h rule pays nobody");
ok(refused(await me(BUYER3, `SELECT public.helpr_task_customer_confirm('${P3.task}')`), /problem_open/), "nor does \"I got it\"");

// lh-money-escrow #1: the ordinary admin "Refund the buyer" would pay the Helpr for the trip (B69); for a damaged item the
// Helpr has, it is refused, so the decision is made explicitly (row 43) and nothing has moved.
ok(refused(await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${prob3}', 'refund_buyer', 'none', false, 'x')`), /delivery_decision_needed/)
  && (await order(P3.order_id)).status === "paid" && one(await svc(`SELECT count(*)::int FROM public.helpr_task_payouts WHERE task_id = '${P3.task}'`)) === 0,
  "\"Refund the buyer\" on a damaged item the Helpr has is refused (decide it as damaged in delivery); nobody is paid");
// An admin who is the Helpr never decides it.
await svc(`INSERT INTO public.user_roles (user_id, role) VALUES ('${HELPR}', 'admin') ON CONFLICT DO NOTHING`);
ok(refused(await me(HELPR, `SELECT public.declutter_admin_decide_problem('${prob3}', 'pay_seller', 'none', false, 'x')`), /not_authorized/),
  "an admin who made the delivery cannot decide its problem");
await svc(`DELETE FROM public.user_roles WHERE user_id = '${HELPR}' AND role = 'admin'`);

// 10. Damage in delivery (row 43): buyer everything back, seller paid, Helpr unpaid + strike.
ok(refused(await me(BUYER3, `SELECT public.declutter_admin_decide_delivery_damage('${prob3}', 'x')`), /not_authorized/), "only an admin decides");
const dmg = one(await me(ADMIN, `SELECT public.declutter_admin_decide_delivery_damage('${prob3}', 'Broken in the truck.')`));
const r3 = await order(P3.order_id);
const ref3 = (await svc(`SELECT * FROM public.declutter_refunds WHERE order_id = '${P3.order_id}'`))[0];
ok(dmg?.result === "delivery_damage" && r3.status === "handed_over"
  && ref3?.reason === "delivery_damage" && ref3.refund_cents === r3.total_cents && ref3.fee_policy === "full_platform_absorbs",
  "damage: the buyer gets every cent back (the delivery fee too), the platform absorbs it");
ok((await svc(`SELECT amount_cents FROM public.declutter_payouts WHERE order_id = '${P3.order_id}'`))[0]?.amount_cents === 3000,
  "the seller is still paid the item price");
ok((await task(P3.task)).status === "failed" && one(await svc(`SELECT count(*)::int FROM public.helpr_task_payouts WHERE task_id = '${P3.task}'`)) === 0,
  "the Helpr is not paid");
ok(one(await svc(`SELECT count(*)::int FROM public.user_violations WHERE user_id = '${HELPR}' AND violation_type = 'delivery_damage'`)) === 1,
  "and gets a delivery strike (jobs ladder)");
await svc(`UPDATE public.declutter_refunds SET created_at = now() - interval '5 minutes' WHERE order_id = '${P3.order_id}'`);
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_refunds_due(50) WHERE order_id = '${P3.order_id}'`)) === 0,
  "the damage refund waits while the seller's payout has not gone (B71)");
const sp3 = one(await svc(`SELECT id FROM public.declutter_payouts WHERE order_id = '${P3.order_id}'`));
const sp3due = (await svc(`SELECT * FROM public.declutter_payouts_due(50) WHERE order_id = '${P3.order_id}'`))[0];
ok(sp3due?.refunds_recorded_cents === 0,
  "the seller payout counts only refunds Stripe confirmed on the charge: the damage refund is not sent yet (lh-money-escrow #2)");
await svc(`SELECT public.declutter_payout_executed('${sp3}', 'tr_s3', true, NULL)`);
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_refunds_due(50) WHERE order_id = '${P3.order_id}'`)) === 1,
  "once the seller is paid, the buyer's refund is due");
ok(refused(await me(ADMIN, `SELECT public.declutter_admin_decide_delivery_damage('${prob3}', 'again')`), /problem_already_decided/),
  "decided once");

// 11. No Helpr in 48 h (row 40): the delivery fee back, the order becomes a pickup.
const P4 = await paidDelivery(12, BUYER, SELLER2, 4000, "large");
const r4 = await order(P4.order_id);
await svc(`UPDATE public.helpr_tasks SET open_until = now() - interval '1 minute' WHERE id = '${P4.task}'`);
const sw4 = one(await svc(`SELECT public.helpr_task_sweep()`));
const r4b = await order(P4.order_id);
const dr4 = (await svc(`SELECT * FROM public.declutter_delivery_refunds WHERE order_id = '${P4.order_id}'`))[0];
ok(sw4?.unfilled >= 1 && (await task(P4.task)).status === "unfilled", "the sweep closes the task unfilled");
ok(dr4?.reason === "no_helpr" && dr4.refund_cents === r4.delivery_cents && dr4.stripe_payment_intent_id === "pi_dl_12",
  "the whole delivery fee is refunded on its own");
ok(r4b.handover === "pickup_home" && r4b.status === "paid" && r4b.delivery_cents === r4.delivery_cents,
  "the order is now a pickup at the seller's home, still paid; the fee it was paid stays on record");
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_delivery_refunds_due(10) WHERE order_id = '${P4.order_id}'`)) === 1,
  "the delivery refund is in declutter-money's queue");
ok(Array.isArray(await me(BUYER, `SELECT public.declutter_book_pickup('${P4.order_id}', '${slot}')`)), "the buyer now books a pickup");
await svc(`UPDATE public.declutter_orders SET paid_at = now() - interval '8 days' WHERE id = '${P4.order_id}'`);
await svc(`UPDATE public.declutter_bookings SET slot_start = NULL, slot_end = NULL WHERE order_id = '${P4.order_id}'`);
await svc(`SELECT public.declutter_handover_sweep()`);
const ref4 = (await svc(`SELECT * FROM public.declutter_refunds WHERE order_id = '${P4.order_id}'`))[0];
ok(ref4?.reason === "buyer_no_show" && ref4.refund_cents === r4.items_cents && ref4.paid_cents === r4.total_cents - r4.delivery_cents,
  `a later buyer no-show refunds EXACTLY the item price: the delivery fee is not refunded twice (${ref4?.refund_cents})`);
ok(one(await svc(`SELECT public.declutter_delivery_refund_executed('${dr4.id}', 're_d4', true, NULL)`)) === "succeeded",
  "the delivery refund is recorded as sent");
ok(one(await svc(`SELECT public.declutter_delivery_refund_reversed('${dr4.id}', 're_other', 'failed')`)) === "unchanged"
  && one(await svc(`SELECT public.declutter_delivery_refund_reversed('${dr4.id}', 're_d4', 'failed')`)) === "reopened",
  "only the recorded refund's failure reopens it");

// 11b. B76: the delivery falls through with under 48 h to the 7-day deadline (silent-failure review #2): the
// sale closes as no one's fault (delivery fee back in full, the rest under the no-fault policy), never as a buyer no-show.
const P11 = await paidDelivery(19, BUYER2, SELLER2, 3000, "small");
await svc(`UPDATE public.declutter_orders SET paid_at = now() - interval '6 days' WHERE id = '${P11.order_id}'`);
await svc(`UPDATE public.helpr_tasks SET open_until = now() - interval '1 minute' WHERE id = '${P11.task}'`);
const strikesBefore11 = one(await svc(`SELECT count(*)::int FROM public.declutter_strikes WHERE user_id = '${BUYER2}'`));
await svc(`SELECT public.helpr_task_sweep()`);
const r11 = await order(P11.order_id);
const ref11 = (await svc(`SELECT * FROM public.declutter_refunds WHERE order_id = '${P11.order_id}'`))[0];
const dr11 = (await svc(`SELECT * FROM public.declutter_delivery_refunds WHERE order_id = '${P11.order_id}'`))[0];
ok(r11.status === "refunded" && dr11?.reason === "no_helpr" && dr11.refund_cents === r11.delivery_cents
  && ref11?.reason === "admin_no_fault" && ref11.paid_cents === r11.total_cents - r11.delivery_cents,
  `late fall-through: the order is closed, the delivery fee and the rest refunded once each (${ref11?.reason}/${ref11?.paid_cents})`);
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_strikes WHERE user_id = '${BUYER2}'`)) === strikesBefore11,
  "...with no buyer strike");
await svc(`SELECT public.declutter_handover_sweep()`);
ok((await svc(`SELECT count(*)::int AS n FROM public.declutter_refunds WHERE order_id = '${P11.order_id}'`))[0].n === 1,
  "and the handover sweep never turns it into a buyer no-show afterwards");

// 11c. lh-money-escrow re-review #1: an open problem freezes the task, so the late fall-through close never
// refunds under the no-fault rule while the admin has a problem to decide.
const P11c = await paidDelivery(21, BUYER3, SELLER2, 3000, "small");
await svc(`UPDATE public.declutter_orders SET paid_at = now() - interval '6 days' WHERE id = '${P11c.order_id}'`);
const prob11c = one(await me(BUYER3, `SELECT public.declutter_report_problem('${P11c.order_id}', 'not_as_described', 'Wrong lamp in the photos.', '{}')`));
await svc(`UPDATE public.helpr_tasks SET open_until = now() - interval '1 minute' WHERE id = '${P11c.task}'`);
await svc(`SELECT public.helpr_task_sweep()`);
ok((await order(P11c.order_id)).status === "paid" && (await task(P11c.task)).status === "open"
  && one(await svc(`SELECT count(*)::int FROM public.declutter_refunds WHERE order_id = '${P11c.order_id}'`)) === 0,
  "with a problem open the sweep leaves the task and the money alone");
ok(Array.isArray(await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${prob11c}', 'refund_buyer', 'seller', false, 'Wrong item.')`))
  && (await order(P11c.order_id)).status === "refunded",
  "and the admin can still decide it");

// 12. A Helpr backing out late, and a Helpr no-show (B64).
const P5 = await paidDelivery(13, BUYER, SELLER, 2500, "small");
await svc(`UPDATE public.helpr_tasks SET open_until = now() + interval '1 hour' WHERE id = '${P5.task}'`);
const soon = one(await svc(`SELECT (date_trunc('minute', now()) + interval '61 minutes')::text`));
await me(HELPR2, `SELECT public.helpr_task_accept('${P5.task}', '${soon}')`);
const rel = one(await me(HELPR2, `SELECT public.helpr_task_release('${P5.task}')`));
const T5 = await task(P5.task);
ok(rel?.strike === true && T5.status === "open" && T5.helpr_id === null && T5.releases === 1,
  "backing out under 2 h before the pickup: a strike, and the delivery goes back up");
ok(one(await svc(`SELECT round(extract(epoch FROM (open_until - now())) / 3600)::int FROM public.helpr_tasks WHERE id = '${P5.task}'`)) >= 23,
  "with at least 24 more hours to find a Helpr");
ok(one(await svc(`SELECT count(*)::int FROM public.user_violations WHERE user_id = '${HELPR2}' AND violation_type = 'delivery_backed_out'`)) === 1,
  "the strike is a delivery strike on the jobs ladder");
// lh-authz-rls #4: taking and backing out must not collect addresses.
ok(refused(await me(HELPR2, `SELECT public.helpr_task_accept('${P5.task}', '${slot}')`), /task_taken/),
  "a Helpr never takes back a delivery they backed out of");
const HELPR3 = NOCARD;   // payout account, 18+, a tester
ok(Array.isArray(await me(HELPR3, `SELECT public.helpr_task_accept('${P5.task}', '${slot}')`)), "another Helpr takes it");
await svc(`UPDATE public.helpr_tasks SET pickup_slot_start = now() - interval '3 hours' WHERE id = '${P5.task}'`);
await svc(`SELECT public.helpr_task_sweep()`);
ok((await task(P5.task)).status === "open"
  && one(await svc(`SELECT count(*)::int FROM public.user_violations WHERE user_id = '${HELPR3}' AND violation_type = 'delivery_no_show'`)) === 1,
  "not picked up 2 h after the pickup time: a no-show strike and back up for another Helpr");
ok(refused(await me(HELPR3, `SELECT public.helpr_task_accept('${P5.task}', '${slot}')`), /task_taken/),
  "nor one they missed");
// Three back-outs in 7 days pause taking new deliveries.
await svc(`INSERT INTO public.helpr_task_events (task_id, task_event, actor_id) VALUES
  ('${P5.task}', 'released', '${OUTSIDER}'), ('${P5.task}', 'released', '${OUTSIDER}'), ('${P5.task}', 'released', '${HELPR2}'), ('${P5.task}', 'released', '${HELPR2}')`);
const P5b = await paidDelivery(20, BUYER, SELLER2, 1500, "small");
ok(refused(await me(HELPR2, `SELECT public.helpr_task_accept('${P5b.task}', '${slot}')`), /too_many_releases/),
  "three back-outs in 7 days pause taking new deliveries");
// lh-authz-rls re-review #1: at most 2 deliveries taken and not picked up at a time.
const Pc1 = await paidDelivery(22, BUYER3, SELLER2, 1500, "small");
const Pc2 = await paidDelivery(23, BUYER, SELLER, 1500, "small");
const takenNow = one(await svc(`SELECT count(*)::int FROM public.helpr_tasks WHERE helpr_id = '${HELPR3}' AND status = 'accepted'`));
for (const pc of [Pc1, Pc2].slice(0, Math.max(0, 2 - takenNow))) await me(HELPR3, `SELECT public.helpr_task_accept('${pc.task}', '${slot}')`);
const Pc3 = await paidDelivery(24, BUYER3, SELLER, 1500, "small");
ok(one(await svc(`SELECT count(*)::int FROM public.helpr_tasks WHERE helpr_id = '${HELPR3}' AND status = 'accepted'`)) === 2
  && refused(await me(HELPR3, `SELECT public.helpr_task_accept('${Pc3.task}', '${slot}')`), /too_many_taken/),
  "a Helpr holding 2 deliveries not yet picked up cannot take a third");
// lh-authz-rls #8: an open task's view applies the same checks as finding it (a block hides it).
ok((await view(HELPR, P5b.task))?.role === "candidate", "an eligible Helpr can view an open task");
await svc(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${BUYER}', '${HELPR}')`);
ok(refused(await me(HELPR, `SELECT public.helpr_task_view('${P5b.task}')`), /task_not_found/),
  "a Helpr the buyer blocked cannot view the open task either");
await svc(`DELETE FROM public.user_blocks WHERE blocker_id = '${BUYER}' AND blocked_id = '${HELPR}'`);

// 13. The seller is not there for the Helpr (B67, revised: evidence + an admin decides; lh-authz-rls #3).
await me(HELPR, `SELECT public.helpr_task_accept('${P5.task}', '${slot}')`);
await photo(HELPR, P5.task, "away.jpg");
const away = `${HELPR}/task/${P5.task}/away.jpg`;
ok(refused(await me(HELPR, `SELECT public.helpr_task_pickup_no_show('${P5.task}', '${away}', ${PICK.lat}, ${PICK.lng})`), /too_early/),
  "\"Seller not there\" waits 15 minutes");
await svc(`UPDATE public.helpr_tasks SET pickup_slot_start = now() - interval '20 minutes' WHERE id = '${P5.task}'`);
ok(refused(await me(HELPR, `SELECT public.helpr_task_pickup_no_show('${P5.task}', NULL, ${PICK.lat}, ${PICK.lng})`), /photo_not_uploaded/),
  "it needs a photo");
ok(refused(await me(HELPR, `SELECT public.helpr_task_pickup_no_show('${P5.task}', '${away}', ${DROP.lat}, ${DROP.lng})`), /not_at_pickup/),
  "taken at the pickup address (within 200 m), not from anywhere");
ok(refused(await me(HELPR, `SELECT public.helpr_task_pickup_no_show('${P5.task}', '${away}', NULL, NULL)`), /location_required/),
  "with a location");
const ns = one(await me(HELPR, `SELECT public.helpr_task_pickup_no_show('${P5.task}', '${away}', ${PICK.lat}, ${PICK.lng})`));
const prob5 = (await svc(`SELECT * FROM public.declutter_problems WHERE order_id = '${P5.order_id}' AND status = 'open'`))[0];
ok(ns?.result === "reported" && prob5?.reporter_side === "helpr" && prob5.reason === "no_show" && prob5.reporter_id === HELPR
  && (await order(P5.order_id)).status === "paid" && (await task(P5.task)).status === "accepted"
  && one(await svc(`SELECT count(*)::int FROM public.declutter_refunds WHERE order_id = '${P5.order_id}'`)) === 0,
  "the report opens a problem for an admin; nothing is refunded and nobody is struck on the Helpr's word alone");
await svc(`UPDATE public.helpr_tasks SET pickup_slot_start = now() - interval '3 hours' WHERE id = '${P5.task}'`);
await svc(`SELECT public.helpr_task_sweep()`);
ok((await task(P5.task)).status === "accepted"
  && one(await svc(`SELECT count(*)::int FROM public.user_violations WHERE user_id = '${HELPR}' AND violation_type = 'delivery_no_show'`)) === 0,
  "while the problem is open the Helpr is not counted a no-show");
ok(Array.isArray(prob5?.photo_paths) && prob5.photo_paths[0] === away,
  "the Helpr's photo is on the problem, so the admin sees the evidence (lh-silent-failure re-review #1)");
ok(refused(await me(HELPR, `SELECT public.helpr_task_release('${P5.task}')`), /problem_open/),
  "while the problem is open the Helpr cannot back out (the task stays until an admin decides)");
ok(refused(await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${prob5.id}', 'pay_seller', 'none', false, 'x')`), /delivery_decision_needed/),
  "B77: after the Helpr's report the item never left the seller, so \"Pay the seller\" is refused");
await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${prob5.id}', 'refund_buyer', 'seller', true, 'Seller was away.')`);
const r5 = await order(P5.order_id);
const ref5 = (await svc(`SELECT * FROM public.declutter_refunds WHERE order_id = '${P5.order_id}'`))[0];
ok(r5.status === "refunded" && ref5?.refund_cents === r5.total_cents && ref5.fee_policy === "full_seller_pays_fee",
  "an admin decides it a seller no-show: the buyer gets everything back, delivery fee included (nobody picked it up)");
ok((await task(P5.task)).status === "cancelled" && one(await svc(`SELECT count(*)::int FROM public.declutter_strikes WHERE user_id = '${SELLER}'`)) >= 1,
  "the task is cancelled and the seller struck");

// 14. An admin refund after the Helpr picked up (B69): the Helpr is paid for the trip.
const P6 = await paidDelivery(14, BUYER3, SELLER2, 6000, "small");
await me(HELPR, `SELECT public.helpr_task_accept('${P6.task}', '${slot}')`);
await photo(HELPR, P6.task, "p.jpg");
await me(HELPR, `SELECT public.helpr_task_picked_up('${P6.task}', '${HELPR}/task/${P6.task}/p.jpg', ${PICK.lat}, ${PICK.lng})`);
const prob6 = one(await me(BUYER3, `SELECT public.declutter_report_problem('${P6.order_id}', 'not_as_described', 'Wrong colour.', '{}')`));
await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${prob6}', 'refund_buyer', 'seller', true, 'Seller listed the wrong item.')`);
const r6 = await order(P6.order_id);
const ref6 = (await svc(`SELECT * FROM public.declutter_refunds WHERE order_id = '${P6.order_id}'`))[0];
ok(ref6?.refund_cents === r6.total_cents - r6.delivery_cents && ref6.fee_policy === "full_seller_pays_fee",
  "refunded for the seller's fault after pickup: everything but the delivery fee comes back");
ok((await task(P6.task)).status === "confirmed" && one(await svc(`SELECT count(*)::int FROM public.helpr_task_payouts WHERE task_id = '${P6.task}'`)) === 1,
  "and the Helpr who made the trip is paid from it");

// 15. An admin pays the seller on a delivery that never happened (B70).
const P7 = await paidDelivery(15, BUYER, SELLER, 2000, "small");
await me(HELPR, `SELECT public.helpr_task_accept('${P7.task}', '${slot}')`);
const prob7 = one(await me(SELLER, `SELECT public.declutter_report_problem('${P7.order_id}', 'other', 'Buyer collected it himself.', '{}')`));
await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${prob7}', 'pay_seller', 'none', false, 'Collected in person.')`);
ok((await order(P7.order_id)).status === "handed_over" && (await task(P7.task)).status === "cancelled"
  && (await svc(`SELECT reason FROM public.declutter_delivery_refunds WHERE order_id = '${P7.order_id}'`))[0]?.reason === "delivery_not_done",
  "the seller is paid, the task cancelled, and the unused delivery fee goes back");
const rec7 = async () => (await svc(`SELECT refunds_recorded_cents FROM public.declutter_payouts_due(50) WHERE order_id = '${P7.order_id}'`))[0]?.refunds_recorded_cents;
const dr7 = one(await svc(`SELECT id FROM public.declutter_delivery_refunds WHERE order_id = '${P7.order_id}'`));
ok(await rec7() === 0, "a delivery refund not yet sent is not counted as given back (lh-money-escrow #2)");
// A refund on ANOTHER payment of the same order (a duplicate payment) never counts either.
await svc(`INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents, kept_cents, refund_cents, status)
  VALUES ('${P7.order_id}', 'pi_dl_15_dup', 'duplicate_payment', 'full_platform_absorbs', 2000, 0, 0, 2000, 'succeeded')`);
ok(await rec7() === 0, "a duplicate payment's refund is on another charge and is not counted");
await svc(`SELECT public.declutter_delivery_refund_executed('${dr7}', 're_d7', true, NULL)`);
ok(await rec7() === (await order(P7.order_id)).delivery_cents,
  "once Stripe confirms it, the seller payout knows the delivery fee was refunded (a known partial refund is not 'not whole')");

// 16. The door rule (a day after the photo, 2026-10-16) when nothing is held.
const P8 = await paidDelivery(16, BUYER, SELLER2, 2000, "small");
await me(HELPR, `SELECT public.helpr_task_accept('${P8.task}', '${slot}')`);
await photo(HELPR, P8.task, "p.jpg");
await photo(HELPR, P8.task, "d.jpg");
await me(HELPR, `SELECT public.helpr_task_picked_up('${P8.task}', '${HELPR}/task/${P8.task}/p.jpg', ${PICK.lat}, ${PICK.lng})`);
await me(HELPR, `SELECT public.helpr_task_delivered('${P8.task}', '${HELPR}/task/${P8.task}/d.jpg', ${DROP.lat}, ${DROP.lng}, NULL)`);
await svc(`UPDATE public.helpr_tasks SET delivered_at = now() - interval '25 hours' WHERE id = '${P8.task}'`);
await svc(`SELECT public.helpr_task_sweep()`);
ok((await task(P8.task)).confirmed_by === "auto" && (await order(P8.order_id)).status === "handed_over",
  "a door drop-off with no problem confirms itself after 24 h");
ok(one(await svc(`SELECT count(*)::int FROM public.cron_defects_seen`)) === 0, "no sweep defect along the way");

// 17. The delivery orders never fall into the booking sweep (B13).
const P9 = await paidDelivery(17, BUYER3, SELLER, 2000, "small");
await svc(`UPDATE public.declutter_orders SET paid_at = now() - interval '8 days' WHERE id = '${P9.order_id}'`);
await svc(`SELECT public.declutter_handover_sweep()`);
ok((await order(P9.order_id)).status === "paid", "the 7-day no-booking rule does not cancel a delivery order");

// 17b. Test accounts and real accounts never meet on a delivery (Stripe mode by parties).
const P10 = await paidDelivery(18, BUYER3, SELLER2, 2000, "small");
await svc(`UPDATE public.profiles SET is_seed = true WHERE user_id IN ('${BUYER3}', '${SELLER2}')`);
ok(one(await me(HELPR, `SELECT count(*)::int FROM public.helpr_tasks_open_near(NULL, NULL, 50) WHERE task_id = '${P10.task}'`)) === 0,
  "a real Helpr does not see a test buyer's delivery");
ok(refused(await me(HELPR, `SELECT public.helpr_task_accept('${P10.task}', '${slot}')`), /task_not_found/), "nor can take it");
await svc(`UPDATE public.profiles SET is_seed = true WHERE user_id = '${SELLER}'`);
ok(one(await me(SELLER, `SELECT count(*)::int FROM public.helpr_tasks_open_near(NULL, NULL, 50) WHERE task_id = '${P10.task}'`)) === 1,
  "a test Helpr does");
ok(one(await me(SELLER, `SELECT count(*)::int FROM public.helpr_tasks_open_near(NULL, NULL, 50) WHERE task_id = '${P8.task}'`)) === 0
  || (await task(P8.task)).status !== "open", "and a test Helpr does not see a real one");
await svc(`UPDATE public.profiles SET is_seed = false WHERE user_id IN ('${BUYER3}', '${SELLER2}', '${SELLER}')`);

// 18. Grants: anon, members on service functions.
for (const sql of [
  `SELECT public.helpr_task_accept('${t1}', now())`, `SELECT public.helpr_task_view('${t1}')`,
  `SELECT * FROM public.helpr_tasks_open_near(30, -91, 5)`, `SELECT public.declutter_delivery_quote('${SELLER}')`,
  `SELECT public.helpr_set_vehicle(false, false, NULL)`, `SELECT * FROM public.helpr_my_tasks()`,
]) ok(refused(await anon(sql), /permission denied/), `anon cannot: ${sql.slice(7, 60)}`);
for (const fn of ["helpr_task_sweep()", "helpr_task_payouts_due(1)", "declutter_delivery_refunds_due(1)",
  `helpr_task_confirm('${t1}', 'admin', NULL)`, `declutter_delivery_refund('${P9.order_id}', 'no_helpr')`,
  `declutter_delivery_on_task_event('${P9.order_id}', '${P9.task}', 'confirmed', 'admin')`]) {
  ok(refused(await me(HELPR, `SELECT public.${fn.includes("(1)") || fn.includes("sweep") ? "" : ""}${fn}`), /permission denied/), `a member cannot call ${fn.split("(")[0]}`);
}
ok(one(await me(HELPR, `SELECT count(*)::int FROM public.helpr_my_tasks()`)) >= 4, "the Helpr lists their own deliveries");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

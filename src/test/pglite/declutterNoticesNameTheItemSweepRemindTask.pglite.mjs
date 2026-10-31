#!/usr/bin/env node
/**
 * PGlite proof for 20261031181404_declutter_notices_name_the_item_sweep_remind_task (Builder 13's read of the live
 * senders, AUD31-17/34, 2026-10-31): three Declutter notices still did not name the item.
 *   1. declutter_handover_sweep (d) "Delivery coming up": the loop locked no order, so the bell named the PREVIOUS
 *      order the sweep had recorded (another order's item for the same pair) or none;
 *   2. declutter_pickup_remind: its EMAIL posted the raw message (the bell row was named);
 *   3. helpr_task_close: the Helpr's "Delivery cancelled" named nothing and opened the retired ?view=deliver;
 *   4. declutter_withdraw_refund (AUD31-33): "Refund request withdrawn" promised the replaced 24-hour rule.
 *
 *   node src/test/pglite/declutterNoticesNameTheItemSweepRemindTask.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterNoticesNameTheItemSweepRemindTask.pglite.mjs # RED: today's bodies
 *   MIGRATION_PATH=<planted copy> node ...                                                       # RED on a planted defect
 *
 * World: scripts/declutter/handoverPhotoWorld.mjs, the bases the handover sweep's own proof applies, the sweep's
 * newest migration (20261031004529), then the newest definition (before this migration) of every notice function
 * these three read, once each; this migration 3x. Test accounts: a seed counterpart never notifies a real member.
 */
import { readFileSync, readdirSync } from "node:fs";
import { buildHandoverWorld, MIG_DIR } from "../../../scripts/declutter/handoverPhotoWorld.mjs";

const NEW_FILE = "20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql";
const SWEEP_FILE = "20261031004529_declutter_handover_both_confirm.sql";
const BASES = [
  "20261027211754_declutter_bundle_discount.sql",
  "20261028200440_declutter_audit3_notices_and_empty_cart.sql",
  "20261028235247_declutter_handover_choices.sql",
  "20261028235709_declutter_handover_photos_at_the_address.sql",
  "20261029002010_declutter_handover_photos_live_only.sql",
  "20261029161347_declutter_porch_weekdays.sql",
  "20261029201542_declutter_porch_photo_not_before_the_day.sql",
  "20261029225634_declutter_problem_both_sides_and_photos.sql",
  "20261030004216_declutter_order_talk.sql",
  "20261030134109_declutter_take_back_problem_report.sql",
  "20261030164712_declutter_porch_places.sql",
];
// What the three bodies read, at their newest definitions before this migration (any dollar tag).
const NEWEST = [
  "declutter_notice_about", "declutter_lock_order", "declutter_notice_names_item", "declutter_price_text",
  "declutter_price_words", "declutter_notice_type", "declutter_notice_link", "declutter_notice_order_link", "declutter_notify_strict", "declutter_notify",
  "declutter_pickup_remind", "helpr_task_close", "declutter_withdraw_refund",
];
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

/** The newest CREATE of public.<name>( in a migration sorting before `before`, with what follows it to the dollar tag. */
function newestBefore(name, before) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
    let m;
    while ((m = re.exec(sql))) {
      const as = /\bAS\s+(\$\w*\$)/g;
      as.lastIndex = m.index;
      const t = as.exec(sql);
      const end = sql.indexOf(t[1], t.index + t[0].length);
      found = { file: f, sql: `${sql.slice(m.index, end + t[1].length)};` };
    }
  }
  if (!found) throw new Error(`no definition of ${name} before ${before}`);
  return found;
}

const { svc, run, one, me, liveItemSql, USERS } = await buildHandoverWorld();
const { SELLER2, BUYER, BUYER2 } = USERS;
let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const short = (r) => JSON.stringify(r)?.slice(0, 260);

for (const f of [...BASES, SWEEP_FILE]) {
  const r = await run(readFileSync(`${MIG_DIR}${f}`, "utf8"));
  ok(!r?.error, `base ${f} applies${r?.error ? `: ${r.error}` : ""}`);
}
await run(`CREATE TABLE IF NOT EXISTS public.test_accounts (user_id uuid PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS public.notification_preferences (user_id uuid PRIMARY KEY);
  ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS declutter_pickups boolean;
  CREATE OR REPLACE FUNCTION public.is_test_subject(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  -- declutter_notify's lost-notice log (4 arguments on prod); recorded where the world's 3-argument one records.
  CREATE OR REPLACE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text, p_ctx jsonb) RETURNS void LANGUAGE sql
    AS $$ INSERT INTO public.cron_defects_seen VALUES (p_fn, p_ref, p_msg) $$;`);
for (const name of NEWEST) {
  const { file, sql } = newestBefore(name, NEW_FILE);
  const r = await run(sql);
  ok(!r?.error, `newest ${name} (${file}) applies${r?.error ? `: ${r.error}` : ""}`);
}
// The writer as on prod: the item-naming trigger on orders (20261028191646) is in the world through its file.
const trg = await run(readFileSync(`${MIG_DIR}20261028191646_declutter_notices_name_the_item.sql`, "utf8")
  .slice(readFileSync(`${MIG_DIR}20261028191646_declutter_notices_name_the_item.sql`, "utf8").indexOf("-- 5. A write to an order")));
ok(!trg?.error, `the order-write trigger (20261028191646 part 5) applies${trg?.error ? `: ${trg.error}` : ""}`);
// Re-apply the newest notice writers over anything the trigger file's tail restated.
for (const name of ["declutter_notify_strict", "declutter_notify", "declutter_pickup_remind"]) await run(newestBefore(name, NEW_FILE).sql);

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `eeeeeeee-0000-0000-0000-${String(n).padStart(12, "0")}`;
await svc(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT '${SELLER2}', d, '00:00', '23:59' FROM generate_series(0, 6) d ON CONFLICT DO NOTHING`);
/** A paid order from SELLER2 to `buyer` for one live item called `title`. */
async function paidOrder(n, title, buyer = BUYER) {
  await run(liveItemSql({ id: I(n), seller: SELLER2, title, price: 2000, floor: 100 }));
  const bought = await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', 2000)`);
  if (!Array.isArray(bought)) console.log("buy_now refused", n, short(bought));
  const started = await me(buyer, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'pickup_home')`);
  const o = started?.[0];
  if (!o?.order_id) console.log("checkout refused", n, short(started));
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_name_${n}', ${o?.total_cents}, now(), 150)`);
  return o?.order_id;
}
const notes = (uid, title) => svc(`SELECT message, link FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}' ORDER BY created_at, id`);
const sweep = async () => {
  await run(`CREATE TEMP TABLE ta_keep AS SELECT * FROM public.test_accounts; DELETE FROM public.test_accounts;`);
  const r = (await svc(`SELECT public.declutter_handover_sweep() AS r`))?.[0]?.r ?? {};
  await run(`INSERT INTO public.test_accounts SELECT * FROM ta_keep ON CONFLICT DO NOTHING; DROP TABLE ta_keep;`);
  return r;
};

// 1. "Delivery coming up" names THIS order's item, both sides, once.
const A = await paidOrder(1, "Walnut side table");
ok(typeof A === "string", `setup: a paid order (${A})`);
await svc(`INSERT INTO public.declutter_seller_deliveries (order_id, buyer_id, seller_id, status, slot_start, slot_end,
    dropoff_address, dropoff_area, dropoff_lat, dropoff_lng)
  VALUES ('${A}', '${BUYER}', '${SELLER2}', 'booked', now() + interval '12 hours', now() + interval '13 hours',
    '12 Oak Street, Lafayette', 'Lafayette', 30.2, -92.0)`);
const s1 = await sweep();
ok(Number(s1.delivery_reminders) === 1, `the sweep sends one reminder (${short(s1)})`);
const sellerNote = await notes(SELLER2, "Delivery coming up");
const buyerNote = await notes(BUYER, "Delivery coming up");
ok(sellerNote.length === 1 && /^Walnut side table: /.test(sellerNote[0].message), `the seller's names the item (${short(sellerNote)})`);
ok(buyerNote.length === 1 && /^Walnut side table: /.test(buyerNote[0].message), `the buyer's names the item (${short(buyerNote)})`);
await sweep();
ok((await notes(SELLER2, "Delivery coming up")).length === 1, "a second run inside the same window sends nothing more");

// 1b. Two orders of one pair in one run: each reminder names its own item, never the other's.
const B = await paidOrder(2, "Brass floor lamp", BUYER2);
const C = await paidOrder(3, "Cedar chest", BUYER2);
for (const [id, h] of [[B, 10], [C, 11]]) {
  await svc(`INSERT INTO public.declutter_seller_deliveries (order_id, buyer_id, seller_id, status, slot_start, slot_end,
      dropoff_address, dropoff_area, dropoff_lat, dropoff_lng)
    VALUES ('${id}', '${BUYER2}', '${SELLER2}', 'booked', now() + interval '${h} hours', now() + interval '${h + 1} hours',
      '40 Pine Street, Lafayette', 'Lafayette', 30.2, -92.0)`);
}
// The order rows were written last for C (its paid write records C for the transaction that wrote it, not the sweep).
await sweep();
const two = (await notes(BUYER2, "Delivery coming up")).map((n) => n.message);
ok(two.length === 2, `two reminders for two orders (${short(two)})`);
ok(two.some((m) => /^Brass floor lamp: /.test(m)) && two.some((m) => /^Cedar chest: /.test(m)), "  each names its own item");
// 1c. An order no longer paid gets no reminder.
const D = await paidOrder(4, "Pine bookshelf", BUYER2);
await svc(`INSERT INTO public.declutter_seller_deliveries (order_id, buyer_id, seller_id, status, slot_start, slot_end,
    dropoff_address, dropoff_area, dropoff_lat, dropoff_lng)
  VALUES ('${D}', '${BUYER2}', '${SELLER2}', 'booked', now() + interval '9 hours', now() + interval '10 hours',
    '40 Pine Street, Lafayette', 'Lafayette', 30.2, -92.0)`);
await run(`ALTER TABLE public.declutter_orders DISABLE TRIGGER USER; UPDATE public.declutter_orders SET status = 'refunded' WHERE id = '${D}'; ALTER TABLE public.declutter_orders ENABLE TRIGGER USER;`);
await sweep();
ok(!(await notes(BUYER2, "Delivery coming up")).some((n) => /Pine bookshelf/.test(n.message)), "a refunded order gets no reminder");

// 2. The pickup reminder's EMAIL names the item, as its bell row does.
await svc(`DELETE FROM net.calls`);
const E = await paidOrder(5, "Rocking chair");
await run(`DO $$ BEGIN
  PERFORM public.declutter_notice_about('${E}');
  PERFORM public.declutter_pickup_remind('${BUYER}', 'Pickup tomorrow', 'Your pickup is tomorrow at 9:00 AM.', '/declutter?tab=buying', '${SELLER2}');
END $$;`);
const bell = await notes(BUYER, "Pickup tomorrow");
const mail = await svc(`SELECT body FROM net.calls ORDER BY id`);
ok(bell.length === 1 && /^Rocking chair: /.test(bell[0].message), `the bell names the item (${short(bell)})`);
ok(mail.length === 1 && /^Rocking chair: Your pickup is tomorrow/.test(mail[0].body?.message ?? ""), `the email names it too (${short(mail)})`);
ok(mail[0]?.body?.message === bell[0]?.message, "  word for word what the bell says");
// A seed counterpart: no bell, no email (test data never reaches a real member).
await svc(`UPDATE public.profiles SET is_seed = true WHERE user_id = '${SELLER2}'`);
await svc(`DELETE FROM net.calls`);
await run(`DO $$ BEGIN
  PERFORM public.declutter_notice_about('${E}');
  PERFORM public.declutter_pickup_remind('${BUYER}', 'Pickup soon', 'Your pickup is in an hour.', '/declutter?tab=buying', '${SELLER2}');
END $$;`);
ok((await notes(BUYER, "Pickup soon")).length === 0 && Number(one(await svc(`SELECT count(*) FROM net.calls`))) === 0,
  "a test seller's reminder reaches a real buyer neither by bell nor by email");
await svc(`UPDATE public.profiles SET is_seed = false WHERE user_id = '${SELLER2}'`);

// 3. The Helpr's "Delivery cancelled" names the task's item and opens Deliver.
const HELPR = BUYER2;
const task = async (n, title, customer) => {
  const id = `ffffffff-0000-0000-0000-${String(n).padStart(12, "0")}`;
  await svc(`INSERT INTO public.helpr_tasks (id, source_kind, source_id, status, size, title, pickup_area, dropoff_area,
      pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng, trip_miles, pay_cents, fee_cents,
      customer_id, helpr_id, open_until, latest_pickup_at, accepted_at, pickup_slot_start, dropoff_code)
    VALUES ('${id}', 'declutter_delivery', gen_random_uuid(), 'accepted', 'small', '${title}', 'Broussard', 'Lafayette',
      '1 Main St, Broussard', 30.1, -91.9, '2 Elm St, Lafayette', 30.2, -92.0, 5, 1500, 145,
      '${customer}', '${HELPR}', now() + interval '1 day', now() + interval '2 days', now(), now() + interval '3 hours', '1234')`);
  return id;
};
const T1 = await task(1, "Oak dresser", BUYER);
const closed = await svc(`SELECT public.helpr_task_close('${T1}', 'cancelled', 'Refunded') AS r`);
ok(one(closed) === "cancelled", `the task closes (${short(closed)})`);
const cancelled = await notes(HELPR, "Delivery cancelled");
ok(cancelled.length === 1 && /Oak dresser/.test(cancelled[0].message), `the Helpr's notice names the item (${short(cancelled)})`);
ok(cancelled[0]?.link === "/declutter?tab=deliver", `  and opens their Deliver tab (${cancelled[0]?.link})`);
// A test customer never notifies a real Helpr.
await svc(`UPDATE public.profiles SET is_seed = true WHERE user_id = '${BUYER}'`);
const T2 = await task(2, "Glass vase", BUYER);
await svc(`SELECT public.helpr_task_close('${T2}', 'cancelled', 'Refunded')`);
ok(!(await notes(HELPR, "Delivery cancelled")).some((n) => /Glass vase/.test(n.message)), "a test customer's cancel never reaches a real Helpr");
await svc(`UPDATE public.profiles SET is_seed = false WHERE user_id = '${BUYER}'`);

// 4. "Refund request withdrawn": the item named, no replaced 24-hour rule, the Selling tab.
await run(`INSERT INTO public.feature_switches (key, audience, description) VALUES ('declutter_refund_requests', 'testers', 'proof')
  ON CONFLICT (key) DO UPDATE SET audience = 'testers'`);
const F = await paidOrder(6, "Velvet armchair");
const rq = one(await svc(`INSERT INTO public.declutter_refund_requests (order_id, reason, note, answer_by)
  VALUES ('${F}', 'damaged', 'A leg is cracked.', now() + interval '24 hours') RETURNING id`));
const wd = await me(BUYER, `SELECT public.declutter_withdraw_refund('${rq}') AS r`);
ok(wd?.[0]?.r?.result === "withdrawn", `the buyer withdraws the request (${short(wd)})`);
const back = await notes(SELLER2, "Refund request withdrawn");
ok(back.length === 1 && /^Velvet armchair: /.test(back[0].message), `the seller's notice names the item (${short(back)})`);
ok(!/24 hours after the handover|sale is final/.test(back[0]?.message ?? "x"), "  and no longer promises the replaced 24-hour rule");
ok(/^\/declutter\?tab=selling/.test(back[0]?.link ?? ""), `  and opens the Selling tab (${back[0]?.link})`);

const defects = await svc(`SELECT * FROM public.cron_defects_seen`);
if (Array.isArray(defects) && defects.length) console.log("cron defects:", short(defects));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

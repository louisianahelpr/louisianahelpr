#!/usr/bin/env node
/**
 * PGlite proof for 20261028191646_declutter_notices_name_the_item (Declutter audit 2, SH2-1 / A2-1): a second
 * order's notice was word-for-word the first one's, so suppress_exact_duplicate_notification dropped it.
 *
 *   node src/test/pglite/declutterNoticesNameTheItem.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterNoticesNameTheItem.pglite.mjs # RED: today's bodies
 *   MIGRATION_PATH=<planted copy> node ...                                         # RED on a planted defect
 *
 * World: the seller-delivery proof's chain (scripts/declutter/slice3Harness.mjs: slices 1-4, the later Declutter
 * money migrations, seller delivery, pickup reminders), then main's notice writer as it is on prod
 * (declutter_notice_type, declutter_price_text/words, declutter_notify_strict, declutter_notify: their newest
 * definitions before this migration) and the duplicate suppressor (20260912045624, verbatim), then this
 * migration 3x. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261028191646_declutter_notices_name_the_item.sql";
const SUPPRESSOR_FILE = "20260912045624_suppress_exact_duplicate_notifications.sql";
const CHAIN_AFTER = [
  "20261021181118_helpr_delivery_payout_round_down.sql",
  "20261021185418_declutter_delivery_raise_pay.sql",
  "20261021204947_declutter_sales_outlive_a_deleted_party.sql",
];
const SETUP_FEE_FILE = "20261026154738_declutter_setup_fee_once.sql";
const REFUND_141D_FILE = "20261026155251_declutter_refund_requests.sql";
const SELLER_DELIVERY_FILE = "20261027153244_declutter_seller_delivery.sql";
const REMINDERS_FILE = "20261027205028_declutter_pickup_reminders.sql";
const OWED_FILE = "20261027163240_payout_setup_only_when_owed.sql";
const FREE_FILE = "20261027170717_declutter_free_section.sql";
const BEFORE = [
  "20261017055500_declutter_refund_hand_settle.sql",
  "20261017055502_declutter_handover_private_bucket.sql",
  "20261017055504_declutter_porch_default.sql",
  "20261017055505_declutter_helpr_delivery.sql",
  NO_QR_FILE,
  "20261018184535_declutter_delivery_no_dropoff_code.sql",
  "20261017060455_declutter_seller_out_pays_fee.sql",
  "20261020024605_shipping_s1_data_model.sql",
  "20261020064354_declutter_manage_listing.sql",
];
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, SELLER2, NOPAYOUT, BUYER, BUYER2, BUYER3, OUTSIDER } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

/** The newest definition of public.<name>( in a migration that sorts before `before` (any dollar tag). */
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
      found = `${sql.slice(m.index, end + t[1].length)};`;
    }
  }
  if (!found) throw new Error(`no definition of ${name} before ${before}`);
  return found;
}

const db = new PGlite();
await db.exec(`CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]);
  INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', true);`);
const extra = [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 },
  ...[...BEFORE, ...CHAIN_AFTER, SETUP_FEE_FILE, REFUND_141D_FILE].map((file) => ({ file, times: 1 }))];
const stmts = setupStatements({ times: 1, times3b: 1, extra });
// The stubs declutterSellerDelivery.pglite.mjs uses (strike ladder, cron defect log, setup fee world).
stmts.splice(1, 0, `
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
  CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    violation_type text NOT NULL, description text, job_id uuid, action_taken text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.cron_defects_seen (fn text, ref text, msg text);
  CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text) RETURNS void LANGUAGE sql
    AS $$ INSERT INTO public.cron_defects_seen VALUES (p_fn, p_ref, p_msg) $$;
  CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text, p_ctx jsonb) RETURNS void LANGUAGE sql
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
  END $$;`);
const feeAt = stmts.indexOf(readFileSync(`${MIG_DIR}${SETUP_FEE_FILE}`, "utf8"));
if (feeAt < 0) throw new Error("setup-fee migration not in the chain");
stmts.splice(feeAt, 0, `
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_fee_paid boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS onboarding_fee_charged_at timestamptz;
  CREATE TABLE IF NOT EXISTS public.platform_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    onboarding_fee_cents integer NOT NULL DEFAULT 200);
  INSERT INTO public.platform_settings (onboarding_fee_cents) VALUES (200);
  CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql
    AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
  CREATE TABLE IF NOT EXISTS public.payout_send_marks (payout_kind text NOT NULL CHECK (payout_kind IN ('declutter', 'helpr_task', 'shop')),
    payout_id uuid NOT NULL, marked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (payout_kind, payout_id));`);
for (const sql of stmts) await db.exec(sql);
await db.exec(`UPDATE public.profiles SET onboarding_fee_paid = true`);
await db.exec(CARDS_SQL);
await db.exec(readFileSync(`${MIG_DIR}${SELLER_DELIVERY_FILE}`, "utf8"));
// The free section (claims, declutter_checkout_free) on its own base, as declutterFreeSection.pglite.mjs builds it:
// 20261027163240's Declutter listing bodies, with the tables its payout gate reads stubbed in prod's shape.
{
  const owed = readFileSync(`${MIG_DIR}${OWED_FILE}`, "utf8");
  const fnSql = (name) => {
    const m = [...owed.matchAll(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
    const open = /\bAS\s+(\$\w*\$)/i.exec(owed.slice(m.index));
    const close = owed.indexOf(open[1], m.index + open.index + open[0].length);
    return owed.slice(m.index, owed.indexOf(";", close) + 1);
  };
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helper_id uuid, payment_status text);
    CREATE TABLE IF NOT EXISTS public.group_job_helpers (job_id uuid, helper_id uuid);
    CREATE TABLE IF NOT EXISTS public.job_accept_pending (job_id uuid, helper_id uuid);
    CREATE TABLE IF NOT EXISTS public.cancellation_fee_transfers (helper_id uuid);
    CREATE TABLE IF NOT EXISTS public.crew_cancellation_fee_shares (helper_id uuid);
    CREATE TABLE IF NOT EXISTS public.crew_block_fees (helper_id uuid);
    CREATE TABLE IF NOT EXISTS public.payout_transfers (helper_id uuid);
    CREATE TABLE IF NOT EXISTS public.shop_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, status text, captured_at timestamptz);
    CREATE TABLE IF NOT EXISTS public.shop_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid);
    CREATE OR REPLACE FUNCTION public.job_payment_is_funded(s text) RETURNS boolean LANGUAGE sql IMMUTABLE
      AS $$ SELECT s IN ('escrow', 'payout_pending') $$;`);
  for (const n of ["declutter_publish_item", "declutter_relist_listing", "payout_setup_hire_allowed"]) await db.exec(fnSql(n));
}
// The free checkout names the taker to the giver with member_display_name (20261021131322, on prod).
await db.exec(newestBefore("member_display_name", NEW_FILE));
await db.exec(readFileSync(`${MIG_DIR}${FREE_FILE}`, "utf8"));
// Prod has seed_hidden_for (20261007033530; it reads the launch switch); the chain lacks it: stubbed "nobody hidden",
// as declutterFreeSection.pglite.mjs does.
await db.exec(`CREATE OR REPLACE FUNCTION public.seed_hidden_for(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  REVOKE ALL ON FUNCTION public.seed_hidden_for(uuid) FROM PUBLIC, anon, authenticated;`);
await db.exec(`CREATE SCHEMA IF NOT EXISTS net; CREATE SCHEMA IF NOT EXISTS vault;
  CREATE TABLE IF NOT EXISTS net.calls (id serial PRIMARY KEY, url text, body jsonb);
  CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}', body jsonb DEFAULT '{}', timeout_milliseconds integer DEFAULT 5000)
    RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id::bigint $$;
  CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (name text, decrypted_secret text);
  CREATE TABLE IF NOT EXISTS public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text NOT NULL DEFAULT 'error',
    message text NOT NULL, tags jsonb NOT NULL DEFAULT '{}', context jsonb NOT NULL DEFAULT '{}');`);
await db.exec(readFileSync(`${MIG_DIR}${REMINDERS_FILE}`, "utf8"));
// The notice writer as on prod today (the notify branch, 20261028162048 / 20261028171944), and the suppressor.
for (const fn of ["declutter_notice_type", "declutter_price_text", "declutter_price_words", "declutter_notify_strict", "declutter_notify"]) {
  await db.exec(newestBefore(fn, NEW_FILE));
}
await db.exec(readFileSync(`${MIG_DIR}${SUPPRESSOR_FILE}`, "utf8"));

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
const run = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
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

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

await db.exec(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT u, d, '09:00', '18:00' FROM unnest(ARRAY['${SELLER}', '${SELLER2}']::uuid[]) u, generate_series(0, 6) d ON CONFLICT DO NOTHING;`);

const I = (n) => `99999999-0000-0000-0000-${String(n).padStart(12, "0")}`;
/** One paid order of the given items (all from `seller`), checked out together. */
async function paidOrder(tag, buyer, seller, items, handover = "pickup_home") {
  for (const [n, title, price] of items) {
    await db.exec(liveItemSql({ id: I(n), seller, title, price, floor: Math.min(price, 100) }));
    await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  }
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${seller}', '${handover}')`))[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_ni_${tag}', ${o?.total_cents}, now(), 150)`);
  return o?.order_id;
}
const msgs = async (uid, title) => (await svc(`SELECT message FROM public.notifications WHERE user_id = '${uid}' AND title = '${title.replace(/'/g, "''")}'
                                                ORDER BY created_at, id`)).map?.((r) => r.message) ?? [];
const suppressed = async (uid, title) => Number(one(await svc(`SELECT count(*) FROM public.notification_dedupe_suppressions
                                                                 WHERE user_id = '${uid}' AND title = '${title.replace(/'/g, "''")}'`)));
const tomorrowNoon = `(((now() AT TIME ZONE 'America/Chicago')::date + 1 + time '12:00') AT TIME ZONE 'America/Chicago')`;

// ---------------------------------------------------------------------------
// A. Two orders, same two people, same pickup time: the audit's dropped "Pickup booked".
const A = await paidOrder("a", BUYER, SELLER, [[1, "Brass lamp", 2000]]);
const B = await paidOrder("b", BUYER, SELLER, [[2, "Oak chair", 3000]]);
ok(A && B && A !== B, "setup: two paid orders between the same buyer and seller");
await me(BUYER, `SELECT public.declutter_book_pickup('${A}', ${tomorrowNoon})`);
await me(BUYER, `SELECT public.declutter_book_pickup('${B}', ${tomorrowNoon})`);
const booked = await msgs(SELLER, "Pickup booked");
ok(booked.length === 2, `the seller gets BOTH "Pickup booked" notices (${booked.length}; suppressed ${await suppressed(SELLER, "Pickup booked")})`);
ok(booked.some((m) => m.startsWith("Brass lamp: Pickup is ")) && booked.some((m) => m.startsWith("Oak chair: Pickup is ")),
  `  each names its own item (${JSON.stringify(booked)})`);

// B. The seller reports a missed pickup on both: the audit's dropped "You missed your pickup".
await svc(`UPDATE public.declutter_bookings SET slot_start = now() - interval '1 hour', slot_end = now() - interval '30 minutes'
            WHERE order_id IN ('${A}', '${B}')`);
await me(SELLER, `SELECT public.declutter_report_no_show('${A}')`);
await me(SELLER, `SELECT public.declutter_report_no_show('${B}')`);
const missed = await msgs(BUYER, "You missed your pickup");
ok(missed.length === 2 && await suppressed(BUYER, "You missed your pickup") === 0,
  `the buyer is told about BOTH missed pickups, none suppressed (${missed.length})`);
ok(missed[0]?.startsWith("Brass lamp: The seller says you did not show up.") && missed[1]?.startsWith("Oak chair: The seller says"),
  `  in order, each naming its own item (${JSON.stringify(missed)})`);

// C. Two orders auto-paid by ONE sweep run: each order's notices name their own item.
const C = await paidOrder("c", BUYER2, SELLER2, [[3, "Blue rug", 1500]]);
const D = await paidOrder("d", BUYER2, SELLER2, [[4, "Green vase", 1200]]);
for (const id of [C, D]) await me(BUYER2, `SELECT public.declutter_book_pickup('${id}', ${tomorrowNoon})`);
await svc(`UPDATE public.declutter_bookings SET slot_start = now() - interval '25 hours', slot_end = now() - interval '24 hours 30 minutes'
            WHERE order_id IN ('${C}', '${D}')`);
await svc(`SELECT public.declutter_handover_sweep()`);
const st = await svc(`SELECT status FROM public.declutter_orders WHERE id IN ('${C}', '${D}')`);
ok(Array.isArray(st) && st.length === 2 && st.every((r) => r.status === "handed_over"), "setup: one sweep run auto-paid both orders");
const enjoy = await msgs(BUYER2, "Enjoy your item");
ok(enjoy.length === 2 && enjoy.some((m) => m.startsWith("Blue rug: ")) && enjoy.some((m) => m.startsWith("Green vase: ")),
  `  the buyer's two "Enjoy your item" both arrive, each naming its own item (${JSON.stringify(enjoy)})`);
const done = await msgs(SELLER2, "Handover done");
ok(done.length === 2 && done.some((m) => m.startsWith("Blue rug: ")) && done.some((m) => m.startsWith("Green vase: ")),
  `  so do the seller's two "Handover done" (${JSON.stringify(done)})`);

// D. Never a wrong item, never a name out of thin air.
const tx = (body) => run(`DO $t$ BEGIN ${body} END $t$;`);
const note = (to, title, link, other) =>
  `PERFORM public.declutter_notify('${to}', 'payment', '${title}', 'Same words every time.', ${link === null ? "NULL" : `'${link}'`}, ${other ? `'${other}'` : "NULL"});`;
const last = async (uid, title) => (await msgs(uid, title)).at(-1);
await tx(`PERFORM public.declutter_lock_order('${A}'); ${note(BUYER, "Probe pair", "/declutter?tab=buying", SELLER)}`);
ok(await last(BUYER, "Probe pair") === "Brass lamp: Same words every time.", "the locked order's own two people: named");
await tx(`PERFORM public.declutter_lock_order('${A}'); ${note(OUTSIDER, "Probe stranger", "/declutter?tab=buying", SELLER)}`);
ok(await last(OUTSIDER, "Probe stranger") === "Same words every time.", "a notice to someone not on the order: unchanged (no item named)");
await tx(`PERFORM public.declutter_lock_order('${A}'); ${note(BUYER, "Probe other seller", "/declutter?tab=buying", SELLER2)}`);
ok(await last(BUYER, "Probe other seller") === "Same words every time.", "the right user but a different counterpart: unchanged");
await tx(`PERFORM public.declutter_lock_order('${A}'); ${note(BUYER, "Probe no other", "/declutter?tab=buying", null)}`);
ok(await last(BUYER, "Probe no other") === "Same words every time.", "no counterpart (a system notice): unchanged");
await tx(`PERFORM public.declutter_lock_order('${A}'); ${note(BUYER, "Probe admin link", "/admin", SELLER)}`);
ok(await last(BUYER, "Probe admin link") === "Same words every time.", "a link outside Declutter: unchanged");
await tx(`PERFORM public.declutter_lock_order('${A}'); PERFORM public.declutter_lock_order('${B}'); ${note(BUYER, "Probe second lock", "/declutter?tab=buying", SELLER)}`);
ok(await last(BUYER, "Probe second lock") === "Oak chair: Same words every time.", "two orders locked in one transaction: the notice names the one locked last");
await tx(`PERFORM public.declutter_lock_order('${A}');`);
await tx(note(BUYER, "Probe next transaction", "/declutter?tab=buying", SELLER));
ok(await last(BUYER, "Probe next transaction") === "Same words every time.", "the order is never carried into the next transaction");
ok((one(await svc(`SELECT current_setting('declutter.notice_order', true) AS v`)) ?? "") === "", "  (nothing left set after it)");
await tx(`PERFORM public.declutter_lock_order('${A}'); PERFORM public.declutter_notify('${BUYER}', 'payment', 'Probe named', '"Brass lamp" is waiting.', '/declutter?tab=buying', '${SELLER}');`);
ok(await last(BUYER, "Probe named") === '"Brass lamp" is waiting.', "a message that already names the item is not named twice");

// E. More than one item; a deleted item.
const M = await paidOrder("m", BUYER, SELLER2, [[5, "Red kettle", 1100], [6, "Tea set", 1400]]);
await tx(`PERFORM public.declutter_lock_order('${M}'); ${note(BUYER, "Probe two items", "/declutter?tab=buying", SELLER2)}`);
ok(await last(BUYER, "Probe two items") === "Red kettle and 1 more: Same words every time.", "an order of two items: \"Red kettle and 1 more\"");
await svc(`UPDATE public.declutter_cart_items SET item_id = NULL WHERE order_id = '${A}'`);
await tx(`PERFORM public.declutter_lock_order('${A}'); ${note(BUYER, "Probe deleted item", "/declutter?tab=buying", SELLER)}`);
ok(await last(BUYER, "Probe deleted item") === "Same words every time.", "the item was deleted: unchanged");

// G. Paths that never lock the order: the order row's own write records it (trg_declutter_orders_a_notice_about).
// G1. declutter_mark_order_paid (the webhook): A and B were paid above, between the same two people.
const buyerPaid = await msgs(SELLER, "Buyer paid");
ok(buyerPaid.length === 2 && buyerPaid.some((m) => m.startsWith("Brass lamp: The buyer paid")) && buyerPaid.some((m) => m.startsWith("Oak chair: The buyer paid")),
  `"Buyer paid" names each order's item (${JSON.stringify(buyerPaid)})`);
const received = await msgs(BUYER, "Payment received");
ok(received.length >= 2 && received.some((m) => m.startsWith("Brass lamp: You paid")) && received.some((m) => m.startsWith("Oak chair: You paid")),
  `"Payment received" too (${JSON.stringify(received)})`);
// G2. declutter_checkout_free: two free claims from the same giver, checked out one after the other.
await db.exec(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT '${NOPAYOUT}'::uuid, d, '00:00', '23:59' FROM generate_series(0, 6) d ON CONFLICT DO NOTHING;`);
for (const [n, title] of [[11, "Free stool"], [12, "Free shelf"]]) {
  await db.exec(liveItemSql({ id: I(n), seller: NOPAYOUT, title, price: 0, floor: 0 }));
  const c = await me(BUYER3, `SELECT public.declutter_claim_free('${I(n)}') AS id`);
  const f = await me(BUYER3, `SELECT public.declutter_checkout_free('${NOPAYOUT}', 'pickup_home') AS id`);
  ok(Array.isArray(c) && Array.isArray(f), `setup: "${title}" claimed and checked out${Array.isArray(f) ? "" : `: ${f?.error ?? c?.error}`}`);
}
const yours = await msgs(BUYER3, "It's yours");
ok(yours.length === 2 && yours[0]?.startsWith("Free stool: ") && yours[1]?.startsWith("Free shelf: "),
  `both "It's yours" arrive, each naming its item (${JSON.stringify(yours)})`);
const claimed = await msgs(NOPAYOUT, "Free item claimed");
ok(claimed.length === 2 && claimed[0]?.startsWith("Free stool: ") && claimed[1]?.startsWith("Free shelf: "),
  `both "Free item claimed" arrive, each naming its item (${JSON.stringify(claimed)})`);
// G3. The seller-delivery trigger (fires on the order's status): "Delivery booked" names the item.
await me(SELLER2, `SELECT public.declutter_set_seller_delivery(true, 2000, 10)`);
const windows = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, starts: "09:00", ends: "17:00" })));
await me(SELLER2, `SELECT public.declutter_set_delivery_schedule('${windows}'::jsonb, NULL)`);
await db.exec(liveItemSql({ id: I(21), seller: SELLER2, title: "Walnut desk", price: 5000, floor: 100 }));
await me(BUYER3, `SELECT public.declutter_buy_now('${I(21)}', 5000)`);
await svc(`SELECT public.declutter_set_delivery_dropoff('${BUYER3}', '${SELLER2}', '500 Drop Rd, Baton Rouge, LA 70805', 'North Baton Rouge', 30.496234, -91.154321)`);
const sdOffer = one(await me(BUYER3, `SELECT public.declutter_seller_delivery_offer('${SELLER2}')`));
const sdOrder = (await me(BUYER3, `SELECT * FROM public.declutter_start_checkout('${SELLER2}', 'seller_delivery', '${sdOffer?.slots?.[0]}', 'leave')`))?.[0];
await svc(`SELECT public.declutter_mark_order_paid('${sdOrder?.order_id}', 'pi_ni_sd', ${sdOrder?.total_cents}, now(), 150)`);
const sdSeller = await msgs(SELLER2, "Delivery booked");
const sdBuyer = await msgs(BUYER3, "Delivery booked");
ok(sdSeller.length === 1 && sdSeller[0].startsWith("Walnut desk: Deliver to ") && sdBuyer.length === 1 && sdBuyer[0].startsWith("Walnut desk: The seller delivers"),
  `the seller-delivery trigger's "Delivery booked" names the item, both sides (${JSON.stringify([sdSeller, sdBuyer, sdOffer?.available ?? sdOffer])})`);
// G4. A member write to an order (if one were ever allowed) is never failed by the recording.
ok(one(await svc(`SELECT prosecdef FROM pg_proc WHERE proname = 'declutter_orders_notice_about'`)) === true,
  "the order trigger's function is a definer (it never fails a write for lack of a grant)");

// F. Grants: the helpers are internal.
for (const fn of ["declutter_notice_about(uuid)", "declutter_notice_names_item(uuid, uuid, text, text)"]) {
  const r = await svc(`SELECT has_function_privilege('anon', 'public.${fn}', 'EXECUTE') AS a, has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') AS m`);
  ok(Array.isArray(r) && r[0]?.a === false && r[0]?.m === false, `members and anon cannot call ${fn.split("(")[0]}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

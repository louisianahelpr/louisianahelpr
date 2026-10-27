#!/usr/bin/env node
/**
 * PGlite proof for 20261027165903_declutter_haul_away_sweep (the daily
 * haul-away sweep: docs/specs/declutter-haul-away.md H1; the condition the
 * declutter_haul_away switch waits on before it goes to everyone).
 *
 *   node src/test/pglite/declutterHaulAwaySweep.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterHaulAwaySweep.pglite.mjs   # RED: no notice, items stay off sale
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterHaulAwaySweep.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 * The Declutter schema is the one declutterHaulAway.pglite.mjs builds (slices
 * 1-4, F1, refund hand-settle, private handover bucket, porch default, Helpr
 * delivery, seller-out pays fee, haul-away 20261017070827). public.jobs is
 * stubbed with the live columns the sweep reads (status, payment_status,
 * stripe_session_id, stripe_payment_intent_id, updated_at, is_seed) plus the
 * live update_jobs_updated_at behaviour (BEFORE UPDATE sets updated_at =
 * now()) and the poster's real DELETE policy (20260903055308). The functions
 * the sweep calls are checked against prod's md5(prosrc), read 2026-10-27
 * (PROD_MD5 below), so the proof runs on prod's bodies, not a stub.
 */
import os from "node:os";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

// PROVENANCE (as declutterHaulAway.pglite.mjs): only main's migrations and this one.
const THIS_FILE = "20261027165903_declutter_haul_away_sweep.sql";
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
let onMain = null;
try {
  onMain = execFileSync("git", ["ls-tree", "--full-tree", "--name-only", "origin/main:supabase/migrations"], { cwd: MIG_DIR, encoding: "utf8" })
    .split("\n").filter((f) => f.endsWith(".sql"));
} catch (e) {
  console.error(`PROVENANCE: cannot read origin/main's migrations (${e.message}); refusing to run`);
  process.exit(2);
}
const allowed = new Set([...onMain, THIS_FILE]);
const foreign = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql") && !allowed.has(f));
if (foreign.length > 0) {
  console.error(`PROVENANCE: ${foreign.length} migration(s) are not on origin/main: ${foreign.join(", ")}; refusing to run`);
  process.exit(2);
}

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, BUYER, SELLER2, SELLER3, OUTSIDER, BANNED } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";
const MIG = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${THIS_FILE}`, "utf8");

const db = new PGlite();
await db.exec(`CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]);
  INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', true);`);
const setup = setupStatements({ times: 1, times3b: 1, extra: [FEE_F1_FILE, SLICE4_FILE,
  "20261017055500_declutter_refund_hand_settle.sql", "20261017055502_declutter_handover_private_bucket.sql",
  "20261017055504_declutter_porch_default.sql", "20261017055505_declutter_helpr_delivery.sql",
  "20261017060455_declutter_seller_out_pays_fee.sql"].map((file) => ({ file, times: 1 })) });
setup.splice(1, 0, `
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
  -- The newest is_caller_banned (Q1803) reads it; live column on prod.
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS under_13_blocked_at timestamptz;
  CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    violation_type text NOT NULL, description text, job_id uuid, action_taken text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.defects (fn text, ref text, msg text);
  CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_err text, p_context jsonb DEFAULT NULL) RETURNS void
    LANGUAGE sql AS $$ INSERT INTO public.defects VALUES (p_fn, p_ref, p_err) $$;
  CREATE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text,
    p_job_id uuid, p_prior_count int, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean,
    p_suspension_days int, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
  RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`);
for (const sql of setup) await db.exec(sql);
await db.exec(CARDS_SQL);
await db.exec(`CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, title text,
    status text NOT NULL DEFAULT 'open', payment_status text DEFAULT 'unpaid', stripe_session_id text,
    stripe_payment_intent_id text, is_seed boolean DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE FUNCTION public.jobs_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
  CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.jobs_touch();
  ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
  GRANT SELECT, DELETE ON public.jobs TO authenticated;
  CREATE POLICY jobs_read ON public.jobs FOR SELECT TO authenticated USING (customer_id = auth.uid());
  CREATE POLICY "Customers can delete their own jobs" ON public.jobs FOR DELETE TO authenticated
    USING ((SELECT auth.uid()) = customer_id AND status = 'open'
           AND ((payment_status = 'unpaid' AND stripe_session_id IS NULL) OR payment_status = 'abandoned'));
  CREATE TABLE public.gift_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, status text NOT NULL);`);
for (let i = 0; i < 3; i++) await db.exec(readFileSync(`${MIG_DIR}20261017070827_declutter_haul_away.sql`, "utf8"));
if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIG);
await db.exec(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT s, d, '09:00', '18:00' FROM unnest(ARRAY['${SELLER}', '${SELLER2}', '${SELLER3}']::uuid[]) s, generate_series(0, 6) d ON CONFLICT DO NOTHING;`);

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
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const I = (n) => `66666666-0000-0000-0000-${String(n).padStart(12, "0")}`;
const J = (n) => `77777777-0000-0000-0000-${String(n).padStart(12, "0")}`;
const DAY = 24;
const itemStatus = async (n) => one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(n)}'`));
const linked = async (n) => one(await svc(`SELECT count(*)::int FROM public.declutter_haul_aways WHERE item_id = '${I(n)}'`));
const jobPay = async (n) => one(await svc(`SELECT payment_status FROM public.jobs WHERE id = '${J(n)}'`));
const notices = async (uid, title) => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}'`));
const item = (n, seller, hours, photos = 3) => db.exec(liveItemSql({ id: I(n), seller, title: `Item ${n}`, liveHoursAgo: hours })
  + (photos > 0 ? `INSERT INTO public.declutter_item_photos (item_id, seller_id, storage_path, position)
    SELECT '${I(n)}', '${seller}', '${seller}/declutter/${I(n)}/' || g || '.jpg', g FROM generate_series(0, ${photos - 1}) g;` : ""));
const job = (n, customer) => svc(`INSERT INTO public.jobs (id, customer_id, title) VALUES ('${J(n)}', '${customer}', 'Haul away')`);
const link = (uid, ns, j) => me(uid, `SELECT public.declutter_link_haul_away(ARRAY[${ns.map((n) => `'${I(n)}'`).join(",")}]::uuid[], '${J(j)}') AS n`);
// Sets job columns, then (optionally) backdates updated_at past the trigger, as days of quiet would.
async function setJob(n, sql, quietDays = null) {
  if (sql) await svc(`UPDATE public.jobs SET ${sql} WHERE id = '${J(n)}'`);
  if (quietDays !== null) {
    await db.exec(`ALTER TABLE public.jobs DISABLE TRIGGER update_jobs_updated_at;
      UPDATE public.jobs SET updated_at = now() - interval '${quietDays} days' WHERE id = '${J(n)}';
      ALTER TABLE public.jobs ENABLE TRIGGER update_jobs_updated_at;`);
  }
}
const ageLink = (n, days) => svc(`UPDATE public.declutter_haul_aways SET updated_at = now() - interval '${days} days' WHERE item_id = '${I(n)}'`);
const sweep = async () => {
  const r = await svc(`SELECT public.declutter_haul_away_sweep() AS r`);
  return Array.isArray(r) ? r[0].r : r;
};

// ---------------------------------------------------------------------------
// 0. Prod-shaped bodies: the functions the sweep calls are prod's (md5(prosrc), prod 2026-10-27).
const PROD_MD5 = {
  declutter_notify: "6bd9b70fb7e977e707bcc612f7917e3b",
  declutter_haul_job_hold: "ac945fa3a7b639a3a81da6530fd3400c",
  declutter_member_out: "7c1d7e7573caf864afcc0eaecbc0e70f",
  feature_enabled_for_user: "a986b711700d4a606cfd57a74aaddcba",
  declutter_link_haul_away: "128e9edc52ae5927a7d66d77e4bf21d3",
  declutter_haul_away_state: "6c626a3191380038a8a2a1b3e887c7e2",
};
const localMd5 = Object.fromEntries((await svc(`SELECT p.proname, md5(p.prosrc) AS m FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN (${Object.keys(PROD_MD5).map((k) => `'${k}'`).join(",")})`)).map((x) => [x.proname, x.m]));
for (const [fn, m] of Object.entries(PROD_MD5)) ok(localMd5[fn] === m, `prod-shaped: ${fn} here is prod's body (md5 ${localMd5[fn]})`);

// ---------------------------------------------------------------------------
// A. The notice: once per listing that reached 14 days unsold, one per seller per run.
await item(1, SELLER, 20 * DAY);
await item(2, SELLER, 15 * DAY);
await item(3, SELLER, 2 * DAY);                 // too soon
await item(4, SELLER2, 20 * DAY);               // one item: named
await item(5, OUTSIDER, 20 * DAY);              // not a tester: switch off for them
await item(6, SELLER2, 20 * DAY);               // in a buyer's cart
await item(7, SELLER2, 20 * DAY);               // already on a haul-away
await item(8, BANNED, 20 * DAY);                // out of Declutter
await item(9, SELLER2, 20 * DAY);               // off sale (ended): not "for sale 14 days"
await item(10, SELLER3, 20 * DAY);              // a seed (test) seller: told about their own listing
await svc(`UPDATE public.declutter_items SET status = 'ended' WHERE id = '${I(9)}'`);
ok(Array.isArray(await me(BUYER, `SELECT public.declutter_buy_now('${I(6)}', 4000) AS r`)), "setup: item 6 is in a buyer's cart");
await job(70, SELLER2);
ok(one(await link(SELLER2, [7], 70)) === 1, "setup: item 7 is on a haul-away (job 70)");
const before = await svc(`SELECT count(*)::int AS n FROM public.notifications`);

const s1 = await sweep();
ok(s1?.notified_sellers === 3 && s1?.notified_items === 4, `A: first run tells 3 sellers about 4 listings (${JSON.stringify(s1)})`);
ok(await notices(SELLER, "Haul-away is open") === 1, "A: a seller with two listings past 14 days gets ONE notice");
ok(one(await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER}' AND title = 'Haul-away is open'`))?.startsWith("2 of your items haven't sold in 2 weeks."),
  "A: ... that counts them");
ok(one(await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER2}' AND title = 'Haul-away is open'`))?.startsWith('"Item 4" hasn\'t sold in 2 weeks.'),
  "A: one listing is named");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE title = 'Haul-away is open' AND (type <> 'info' OR link <> '/declutter?view=mine')`)) === 0,
  "A: type 'info' (push follows the member's own switches), linked to My listings");
ok(await notices(SELLER3, "Haul-away is open") === 1, "A: a seed seller is told about their own listing (no other party)");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE title = 'Haul-away is open' AND user_id NOT IN ('${SELLER}', '${SELLER2}', '${SELLER3}')`)) === 0,
  "A: nobody but the listing's seller is told");
ok(await notices(OUTSIDER, "Haul-away is open") === 0 && await notices(BANNED, "Haul-away is open") === 0,
  "A: not told: a seller the switch is off for, a banned seller");
const marked = (await svc(`SELECT item_id FROM public.declutter_haul_away_notices ORDER BY item_id`)).map?.((x) => x.item_id) ?? [];
ok(JSON.stringify(marked) === JSON.stringify([I(1), I(2), I(4), I(10)]),
  "A: marked exactly: items 1, 2, 4, 10 (not too-soon 3, switch-off 5, in-cart 6, on a haul-away 7, banned 8, off sale 9)");
const s2 = await sweep();
ok(s2?.notified_items === 0 && await notices(SELLER, "Haul-away is open") === 1 && await notices(SELLER2, "Haul-away is open") === 1,
  "A: the next day's run tells nobody again (the notified-at mark)");
await svc(`UPDATE public.declutter_items SET live_at = now() - interval '15 days' WHERE id = '${I(3)}'`);
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter_haul_away'`);
const s3 = await sweep();
ok(s3?.notified_items === 0 && one(await svc(`SELECT count(*)::int FROM public.declutter_haul_away_notices WHERE item_id = '${I(3)}'`)) === 0,
  "A: switch off: item 3 (now 15 days) is neither told nor marked");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter_haul_away'`);
const s4 = await sweep();
ok(s4?.notified_items === 1 && await notices(SELLER, "Haul-away is open") === 2, "A: switch back on: item 3 is told then, once");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications`)) - before[0].n === 4, "A: four notices in all over four runs");

// ---------------------------------------------------------------------------
// B. A declined card's haul-away job, checkout gone: 'failed' -> 'abandoned'.
for (const n of [20, 21, 22, 23, 24, 25, 26]) await item(n, SELLER, 20 * DAY);
const failedJob = async (n, itemN, extra = "") => {
  await job(n, SELLER);
  ok(one(await link(SELLER, [itemN], n)) === 1, `B setup: item ${itemN} on job ${n}`);
  await setJob(n, `payment_status = 'failed'${extra}`, 2);
};
await failedJob(20, 20);                                              // the case: moves
await failedJob(21, 21, `, stripe_session_id = 'cs_open'`);           // checkout still open: the card may be retried
await failedJob(22, 22, `, stripe_payment_intent_id = 'pi_funded'`);  // funded once, then its bank payment bounced
await failedJob(23, 23);                                              // a gift card is reserved on it
await svc(`INSERT INTO public.gift_cards (job_id, status) VALUES ('${J(23)}', 'reserved')`);
await failedJob(24, 24);
await setJob(24, null, 0);                                            // touched within the day
await failedJob(25, 25);
await setJob(25, `status = 'cancelled'`, 2);                          // not open
await job(26, SELLER);
await setJob(26, `payment_status = 'failed'`, 2);                     // not a haul-away job
ok((await me(SELLER, `DELETE FROM public.jobs WHERE id = '${J(20)}' RETURNING id`)).length === 0,
  "B before: the poster's own delete of the failed job matches nothing (the residual)");
const b = await sweep();
ok(b?.jobs_abandoned === 1 && await jobPay(20) === "abandoned", `B: the declined card's haul-away job is now 'abandoned' (${JSON.stringify(b)})`);
for (const [n, why] of [[21, "a checkout still open"], [22, "funded once (bounced bank payment: return_bounced_gift_card needs 'failed')"],
  [23, "a reserved gift"], [24, "touched within the day"], [25, "cancelled"], [26, "not a haul-away job"]]) {
  ok(await jobPay(n) === "failed", `B: job ${n} stays 'failed': ${why}`);
}
ok((await me(SELLER, `SELECT job_hold FROM public.declutter_haul_away_state(ARRAY['${I(20)}']::uuid[])`))[0]?.job_hold === "job_open",
  "B: My listings now reads it 'job_open' (deletable), not 'job_stuck'");
ok(await itemStatus(20) === "ended" && await linked(20) === 1, "B: just moved: its item waits (the job was touched today)");

// ---------------------------------------------------------------------------
// C. Put back on sale after 7 days when the job holds nothing.
for (const n of [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 44, 45]) await item(n, SELLER, 20 * DAY);
await item(43, SELLER, 20 * DAY, 0);
for (const n of [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45]) {
  await job(n, SELLER);
  ok(one(await link(SELLER, [n], n)) === 1, `C setup: item ${n} on job ${n}`);
}
await svc(`UPDATE public.declutter_items SET status = 'ended' WHERE id = '${I(41)}'`);
await svc(`UPDATE public.declutter_haul_aways SET prior_status = 'ended' WHERE item_id = '${I(41)}'`);
await svc(`DELETE FROM public.jobs WHERE id IN ('${J(30)}', '${J(31)}')`);  // 30: 8 days, 31: 3 days
await setJob(32, `status = 'cancelled', payment_status = 'cancelled'`, 2);
await setJob(33, `payment_status = 'abandoned', stripe_session_id = 'cs_dead'`, 2);
await setJob(34, `payment_status = 'abandoned'`, 0);                     // abandoned today
await setJob(35, null, 2);                                                // unpaid, no session (void-cancelled-payments decides)
await setJob(36, `stripe_session_id = 'cs_live'`, 2);                     // paying
await setJob(37, `payment_status = 'escrow'`, 2);                         // booked
await setJob(38, `status = 'completed', payment_status = 'released'`, 2); // hauled
await setJob(39, `payment_status = 'failed', stripe_payment_intent_id = 'pi_x'`, 2); // job_stuck, not movable
await setJob(40, `payment_status = 'abandoned'`, 2);                      // the link itself is only 6 days old
await setJob(41, `payment_status = 'abandoned'`, 2);                      // prior status 'ended'
await setJob(42, `status = 'cancelled', payment_status = 'unpaid'`, 2);
await setJob(43, `payment_status = 'abandoned'`, 2);                      // no photos
await setJob(44, `payment_status = 'abandoned', stripe_payment_intent_id = 'pi_44'`, 2); // abandoned yet carrying a PaymentIntent
await setJob(45, `payment_status = 'abandoned'`, 2);                      // abandoned, a gift card redeemed on it
await svc(`INSERT INTO public.gift_cards (job_id, status) VALUES ('${J(45)}', 'redeemed')`);
for (const n of [30, 32, 33, 34, 35, 36, 37, 38, 39, 41, 42, 43, 44, 45]) await ageLink(n, 8);
await ageLink(31, 3);
await ageLink(40, 6);
await ageLink(20, 8);
const backBefore = await notices(SELLER, "Back on sale");
const c = await sweep();
ok(await itemStatus(30) === "live" && await linked(30) === 0, `C: job deleted, link 8 days old: back on sale (${JSON.stringify(c)})`);
ok(await itemStatus(32) === "live" && await linked(32) === 0, "C: job cancelled with no money kept: back on sale");
ok(await itemStatus(33) === "live" && await linked(33) === 0, "C: job open and 'abandoned' (Stripe said its checkout is dead), quiet a day: back on sale");
ok(await jobPay(33) === "abandoned" && one(await svc(`SELECT status FROM public.jobs WHERE id = '${J(33)}'`)) === "open",
  "C: ... and the job itself is left as it was (nothing deletes or cancels a job)");
ok(await itemStatus(42) === "live", "C: cancelled + unpaid: back on sale");
for (const [n, why] of [[31, "link only 3 days old"], [34, "abandoned today"], [35, "unpaid with no session: not abandoned yet"],
  [36, "a checkout that can still be paid"], [37, "paid (escrow)"], [38, "hauled"], [39, "job_stuck that is not movable (funded once)"],
  [40, "link only 6 days old"], [20, "job moved to 'abandoned' today"],
  [44, "abandoned job carrying a PaymentIntent (money guard, review 2026-10-27 #2)"], [45, "abandoned job with a redeemed gift card"]]) {
  ok(await itemStatus(n) === "ended" && await linked(n) === 1, `C: item ${n} stays off sale and linked: ${why}`);
}
ok(await itemStatus(41) === "ended" && await linked(41) === 0, "C: an item that was off sale before the haul-away: the link goes, it stays off sale");
ok(await itemStatus(43) === "ended" && await linked(43) === 0 && await notices(SELLER, "Haul-away not booked") === 1,
  "C: no photos: stays off sale, link gone, the seller is told how to put it back");
ok(await notices(SELLER, "Back on sale") === backBefore + 4, "C: one 'Back on sale' notice per item put back (30, 32, 33, 42)");
ok(c?.links_undone === 6 && c?.items_back_on_sale === 4 && c?.errors === 0, "C: the run reports 6 links undone, 4 back on sale, 0 errors");
// The next day: the job part B moved is quiet now, and its item comes back.
await setJob(20, null, 2);
const c2 = await sweep();
ok(await itemStatus(20) === "live" && await linked(20) === 0 && c2?.items_back_on_sale === 1,
  "C: next run: the declined card's job (abandoned yesterday) lets its item back on sale");
// The retry of that abandoned job (Post a Job re-links first) takes the item off sale again: never paid for an item on sale.
ok(one(await link(SELLER, [33], 33)) === 1 && await itemStatus(33) === "ended",
  "C: a later retry of the abandoned job re-links first: the item goes off sale again before any payment");
// The poster may now delete the moved job (My listings' "Put back on sale" works too).
ok((await me(SELLER, `DELETE FROM public.jobs WHERE id = '${J(20)}' RETURNING id`)).length === 1,
  "C: the abandoned job is deletable by its poster under RLS (the delete policy)");

// ---------------------------------------------------------------------------
// D. A failure is logged and the run goes on; nobody but the service role may run it or read the mark.
await item(50, SELLER, 20 * DAY);
await item(51, SELLER, 20 * DAY);
for (const n of [50, 51]) { await job(n, SELLER); await link(SELLER, [n], n); await setJob(n, `payment_status = 'abandoned'`, 2); await ageLink(n, 8); }
await db.exec(`CREATE FUNCTION public.d_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'd_planted'; END $$;
  CREATE TRIGGER d_boom BEFORE UPDATE ON public.declutter_items FOR EACH ROW WHEN (NEW.id = '${I(50)}') EXECUTE FUNCTION public.d_boom();`);
const d = await sweep();
ok(d?.errors === 1 && await itemStatus(51) === "live", "D: one item failing does not stop the next");
ok(await itemStatus(50) === "ended" && await linked(50) === 1, "D: the failed item is left exactly as it was (its sub-block rolled back)");
ok(one(await svc(`SELECT count(*)::int FROM public.defects WHERE fn = 'declutter_haul_away_sweep' AND ref = '${I(50)}' AND msg LIKE '%d_planted%'`)) === 1,
  "D: and the failure is recorded for ops (log_cron_defect)");
await db.exec(`DROP TRIGGER d_boom ON public.declutter_items`);
for (const role of ["anon", "authenticated"]) {
  ok(one(await svc(`SELECT has_function_privilege('${role}', 'public.declutter_haul_away_sweep()', 'EXECUTE')`)) === false, `D: ${role} cannot run the sweep`);
  ok(one(await svc(`SELECT has_table_privilege('${role}', 'public.declutter_haul_away_notices', 'SELECT')`)) === false, `D: ${role} cannot read the notified-at mark`);
  ok(one(await svc(`SELECT has_function_privilege('${role}', 'public.declutter_haul_away_sweep_candidates(integer)', 'EXECUTE')`)) === false, `D: ${role} cannot list the sweep's candidates`);
}
ok(one(await svc(`SELECT has_function_privilege('service_role', 'public.declutter_haul_away_sweep()', 'EXECUTE')`)) === true, "D: the service role (the cron) can");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

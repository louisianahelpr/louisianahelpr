#!/usr/bin/env node
/**
 * PGlite proof for 20261017070827_declutter_haul_away (Declutter haul-away:
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
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

// PROVENANCE (lh-authz-rls re-review 2026-10-17): this proof reads migrations
// from supabase/migrations (the setup files below, and newestDefinition scans
// the whole folder), so it is only evidence when that folder holds main's
// migrations, the Declutter stack's and this one: never a file from another
// unmerged branch. Every .sql file on disk must be in origin/main or the stack
// ref (DECLUTTER_STACK_REF, default origin/ready/declutter-stack; once it is on
// main, origin/main alone), else it stops before any check (fail closed: git
// missing or a ref unreadable stops it too). A planted copy (MIGRATION_PATH)
// is read from its own path and is not in the folder.
const THIS_FILE = "20261017070827_declutter_haul_away.sql";
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
function migrationsAt(ref) {
  try {
    return execFileSync("git", ["ls-tree", "--full-tree", "--name-only", `${ref}:supabase/migrations`], { cwd: MIG_DIR, encoding: "utf8" })
      .split("\n").filter((f) => f.endsWith(".sql"));
  } catch {
    return null;
  }
}
const onMain = migrationsAt("origin/main");
if (!onMain) {
  console.error("PROVENANCE: cannot read origin/main's migrations (git fetch first); refusing to run");
  process.exit(2);
}
const stackRef = process.env.DECLUTTER_STACK_REF ?? "origin/ready/declutter-stack";
const onStack = migrationsAt(stackRef) ?? [];
const allowed = new Set([...onMain, ...onStack, THIS_FILE]);
const foreign = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql") && !allowed.has(f));
if (foreign.length > 0) {
  console.error(`PROVENANCE: ${foreign.length} migration(s) are on neither origin/main nor ${stackRef}: ${foreign.join(", ")}; refusing to run`);
  process.exit(2);
}
console.log(`provenance: ${readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).length} migrations, all on origin/main (${onMain.length}) or ${stackRef} (${onStack.length}) or this one`);

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, BUYER, SELLER2, OUTSIDER, BANNED } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";
const MIG = readFileSync(
  process.env.MIGRATION_PATH ?? `${MIG_DIR}${THIS_FILE}`,
  "utf8",
);

const db = new PGlite();
// The newest Declutter schema: slices 1-4, F1, lane J's refund hand-settle and
// private handover bucket, porch default and Helpr delivery (20261017055505),
// so the item and cart statuses read here are the ones prod has.
await db.exec(`CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]);
  INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', true);`);
const setup = setupStatements({ times: 1, times3b: 1, extra: [FEE_F1_FILE, SLICE4_FILE,
  "20261017055500_declutter_refund_hand_settle.sql", "20261017055502_declutter_handover_private_bucket.sql",
  "20261017055504_declutter_porch_default.sql", "20261017055505_declutter_helpr_delivery.sql",
  "20261017060455_declutter_seller_out_pays_fee.sql"].map((file) => ({ file, times: 1 })) });
// The delivery migration's callees the harness does not create (its own proof stubs them the same way).
setup.splice(1, 0, `
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
  CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    violation_type text NOT NULL, description text, job_id uuid, action_taken text, created_at timestamptz DEFAULT now());
  CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text) RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
  CREATE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text,
    p_job_id uuid, p_prior_count int, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean,
    p_suspension_days int, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
  RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`);
for (const sql of setup) await db.exec(sql);
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
ok((await me(SELLER, `SELECT job_hold FROM public.declutter_haul_away_state(ARRAY['${I(1)}']::uuid[])`))[0]?.job_hold === "job_stuck",
  "declined card, session expired: job_stuck (no checkout can complete, and its poster cannot delete it, so the app never tries)");
ok((await state(SELLER, [I(1)]))[I(1)]?.state === "unpaid", "job_stuck still reads 'unpaid' on the listing");
ok(refused(await cancel(SELLER, I(1)), /haul_away_job_open/) && refused(await link(SELLER, [I(1)], J(3)), /haul_away_job_open/),
  "job_stuck: undo and re-point refused, as for job_open");
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
// A cancelled job that kept no money (no refund: nothing is put back automatically).
await svc(`UPDATE public.jobs SET status = 'cancelled', payment_status = 'cancelled' WHERE id = '${J(3)}'`);
ok((await state(SELLER, [I(1)]))[I(1)]?.state === "unpaid", "a cancelled haul-away job that kept no money reads 'unpaid' (book again / put back)");
ok((await me(SELLER, `SELECT job_hold FROM public.declutter_haul_away_state(ARRAY['${I(1)}']::uuid[])`))[0]?.job_hold === "none",
  "and its hold is 'none': the app goes straight to undo, never deleting the cancelled job");
ok(one(await cancel(SELLER, I(1))) === "ended", "after the job is cancelled the link may go; no photos on item 1, so it stays off sale");
ok(refused(await cancel(SELLER, I(1)), /haul_away_not_found/), "nothing left to undo");
ok(one(await svc(`SELECT has_function_privilege('authenticated', 'public.declutter_haul_job_hold(uuid)', 'EXECUTE')`)) === false,
  "the hold helper is service-only");

// F. The re-link before a retry (re-review 2026-10-17, finding 1): Post a Job
//    re-links before paying again for a job whose hand-off answer was lost. A
//    gift card may have funded it meanwhile; re-linking the same items to it
//    is success, not haul_away_job_not_found (which the app used to answer by
//    deleting the funded job's photos).
for (const n of [30, 31, 32]) await db.exec(liveItemSql({ id: I(n), title: `Haul item ${n}`, liveHoursAgo: 20 * DAY }));
await job(30, SELLER);
ok(one(await link(SELLER, [I(30), I(31)], J(30))) === 2, "F: items 30 and 31 link to job 30 (never paid)");
await setJob(30, `payment_status = 'escrow'`);
const before30 = await svc(`SELECT item_id, job_id, updated_at FROM public.declutter_haul_aways WHERE job_id = '${J(30)}' ORDER BY item_id`);
ok(one(await link(SELLER, [I(31), I(30)], J(30))) === 2, "F: funded (gift card) since: re-linking the SAME items to it answers success");
ok(JSON.stringify(await svc(`SELECT item_id, job_id, updated_at FROM public.declutter_haul_aways WHERE job_id = '${J(30)}' ORDER BY item_id`)) === JSON.stringify(before30)
  && await itemStatus(I(30)) === "ended", "F: and changes nothing");
ok(refused(await link(SELLER, [I(30), I(31), I(32)], J(30)), /haul_away_job_not_found/),
  "F: a funded job still takes no NEW item (only an exact re-link is answered early)");
ok(refused(await link(SELLER, [I(30)], J(30)), /haul_away_job_not_found/),
  "F: a subset of a funded job's items is not an exact re-link either");
ok(refused(await link(SELLER2, [I(30), I(31)], J(30)), /haul_away_job_not_found|item_not_found/),
  "F: another member re-linking the seller's items to the seller's job is refused");
ok(refused(await me(SELLER, `SELECT public.declutter_link_haul_away(ARRAY['${I(30)}', '${I(31)}']::uuid[], NULL) AS n`), /haul_away_job_not_found/),
  "F: a NULL job id is never an early success");
await svc(`UPDATE public.jobs SET payment_status = 'unpaid' WHERE id = '${J(30)}'`);
await svc(`DELETE FROM public.jobs WHERE id = '${J(30)}'`);
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_haul_aways WHERE item_id IN ('${I(30)}', '${I(31)}') AND job_id IS NULL`)) === 2,
  "F: (job deleted: its links are kept with no job)");
await job(31, SELLER);
ok(one(await link(SELLER, [I(30), I(31)], J(31))) === 2, "F: links whose job was deleted are re-pointed, never read as already linked");

// G. A FULL refund puts the items back on sale (owner, 2026-10-17, morning Q3).
//    Before: a finished haul-away job refunded in full kept its items off sale forever.
const photos3 = (n) => svc(`INSERT INTO public.declutter_item_photos (item_id, seller_id, storage_path, position)
  SELECT '${I(n)}', '${SELLER}', '${SELLER}/declutter/${I(n)}/' || g || '.jpg', g FROM generate_series(0, 2) g`);
const linked = async (n) => one(await svc(`SELECT count(*)::int FROM public.declutter_haul_aways WHERE item_id = '${I(n)}'`));
const backNotices = async () => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${SELLER}' AND title = 'Back on sale'`));
for (const n of [40, 41, 42, 43, 44, 45, 47]) { await db.exec(liveItemSql({ id: I(n), title: `Haul item ${n}`, liveHoursAgo: 20 * DAY })); await photos3(n); }
await svc(`UPDATE public.declutter_items SET status = 'ended' WHERE id = '${I(41)}'`);
// G1: a finished job (completed, payout pending) refunded in full (the charge.refunded webhook's flip).
await job(40, SELLER);
ok(one(await link(SELLER, [I(40), I(41)], J(40))) === 2, "G: items 40 (live) and 41 (already off sale) link to job 40");
await setJob(40, `status = 'completed', payment_status = 'payout_pending'`);
ok((await state(SELLER, [I(40)]))[I(40)]?.state === "hauled", "G: the finished job reads 'hauled'");
const notices0 = await backNotices();
await setJob(40, `payment_status = 'refunded'`);
ok(await itemStatus(I(40)) === "live", "G1: a finished haul-away job refunded in full puts its live item back on sale, automatically");
ok(await itemStatus(I(41)) === "ended", "G1: an item that was already off sale before the haul-away stays off sale (its prior status)");
ok(await linked(40) === 0 && await linked(41) === 0, "G1: both links are gone (the items are free to sell or book again)");
ok(await backNotices() === notices0 + 1, "G1: the seller is told once, for the item put back on sale");
ok((await state(SELLER, [I(40)]))[I(40)]?.state === "eligible", "G1: My listings reads it as unsold again, not 'hauled'");
// G2: a disputed job refunded in full by a 100/0 dispute split (status stays 'disputed').
await job(42, SELLER);
ok(one(await link(SELLER, [I(42)], J(42))) === 1, "G2: item 42 links to job 42");
await setJob(42, `status = 'disputed', payment_status = 'escrow'`);
ok((await state(SELLER, [I(42)]))[I(42)]?.state === "booked", "G2: a disputed job holding escrow reads 'booked'");
await setJob(42, `payment_status = 'refunded'`);
ok(await itemStatus(I(42)) === "live" && await linked(42) === 0, "G2: a disputed haul-away job refunded in full puts the item back on sale");
// G3: an admin refund cancels and refunds in one write.
await job(43, SELLER);
ok(one(await link(SELLER, [I(43)], J(43))) === 1, "G3: item 43 links to job 43");
await setJob(43, `status = 'completed', payment_status = 'payout_pending'`);
await setJob(43, `status = 'cancelled', payment_status = 'refunded'`);
ok(await itemStatus(I(43)) === "live" && await linked(43) === 0, "G3: an admin full refund (cancelled + refunded in one write) puts the item back on sale");
// G4: what does NOT put an item back.
await job(44, SELLER);
ok(one(await link(SELLER, [I(44)], J(44))) === 1, "G4: item 44 links to job 44");
await setJob(44, `status = 'accepted', payment_status = 'escrow'`);
await setJob(44, `payment_status = 'refunded'`);
ok(await itemStatus(I(44)) === "ended" && await linked(44) === 1, "G4: a LIVE job (accepted) marked refunded is left alone (fail closed: it may still be worked)");
ok(refused(await cancel(SELLER, I(44)), /haul_away_already_booked/), "G4: and the seller cannot undo it either ('booked')");
await setJob(44, `status = 'cancelled'`);
ok(await itemStatus(I(44)) === "live" && await linked(44) === 0, "G4: once that refunded job is closed, its item goes back on sale (the trigger fires on the status change)");
await job(45, SELLER);
ok(one(await link(SELLER, [I(45)], J(45))) === 1, "G4: item 45 links to job 45");
await setJob(45, `status = 'completed', payment_status = 'released'`);
await setJob(45, `payment_status = 'chargeback'`);
ok(await itemStatus(I(45)) === "ended" && await linked(45) === 1, "G4: a chargeback is not a refund: the hauled item stays off sale");
// G5: a refund on a job with no haul-away changes nothing and still lands.
await job(46, SELLER, "escrow", "completed");
await setJob(46, `payment_status = 'refunded'`);
ok(one(await svc(`SELECT payment_status FROM public.jobs WHERE id = '${J(46)}'`)) === "refunded", "G5: refunding a job with no haul-away links works as before");
// G6: the refund write lands even when putting the items back fails (logged, items left as they were).
await job(47, SELLER);
ok(one(await link(SELLER, [I(47)], J(47))) === 1, "G6: item 47 links to job 47");
await setJob(47, `status = 'completed', payment_status = 'payout_pending'`);
await db.exec(`CREATE TABLE public.g6_defects (fn text, ref text, msg text);
  CREATE OR REPLACE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.g6_defects VALUES (p_fn, p_ref, p_msg) $$;
  CREATE FUNCTION public.g6_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'g6_planted'; END $$;
  CREATE TRIGGER g6_boom BEFORE UPDATE ON public.declutter_items FOR EACH ROW WHEN (NEW.id = '${I(47)}') EXECUTE FUNCTION public.g6_boom();`);
const g6 = await setJob(47, `payment_status = 'refunded'`);
ok(Array.isArray(g6) && one(await svc(`SELECT payment_status FROM public.jobs WHERE id = '${J(47)}'`)) === "refunded",
  "G6: a failure putting the items back never blocks the refund write");
ok(await itemStatus(I(47)) === "ended" && await linked(47) === 1, "G6: the items are left exactly as they were (the sub-block rolled back)");
ok(one(await svc(`SELECT count(*)::int FROM public.g6_defects WHERE fn = 'declutter_haul_away_job_refunded' AND ref = '${J(47)}' AND msg LIKE '%g6_planted%'`)) === 1,
  "G6: and the failure is recorded for ops (log_cron_defect)");
ok((await me(SELLER, `SELECT job_hold FROM public.declutter_haul_away_state(ARRAY['${I(47)}']::uuid[])`))[0]?.job_hold === "none",
  "G6: the hold rule reads the refunded finished job as 'none', so the seller's own 'Put back on sale' still works");
await db.exec(`DROP TRIGGER g6_boom ON public.declutter_items`);
ok(one(await cancel(SELLER, I(47))) === "live", "G6: ... and it does");
ok(one(await svc(`SELECT has_function_privilege('authenticated', 'public.declutter_haul_away_job_refunded()', 'EXECUTE')`)) === false
  && one(await svc(`SELECT has_function_privilege('anon', 'public.declutter_haul_away_job_refunded()', 'EXECUTE')`)) === false,
  "G: the trigger function is not callable by a client role");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

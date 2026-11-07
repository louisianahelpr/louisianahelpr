#!/usr/bin/env node
/**
 * PGlite proof for 20261107174801_declutter_buy_now_one_page (owner 11-07: Declutter Buy now uses ONE Stripe page).
 *   1. Buy now holds an item for a buyer with NO saved card (it used to refuse card_required).
 *   2. An offer still refuses a buyer with no saved card (declutter_make_offer, real), and so does every 2-argument
 *      lock caller (request_bundle / answer_bundle use that form); a NULL p_need_card fails closed.
 *   3. The reminder ~10 minutes before a Buy now hold ends: once per buyer and seller, only in the 2-12 minute window,
 *      never for a seed item or a seed account, a lost notice is retried next run, and sweep_deadline_reminders runs it.
 *
 *   node src/test/pglite/declutterBuyNowOnePage.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterBuyNowOnePage.pglite.mjs # RED: Buy now refuses, no reminder
 *   MUTANT=<name> node src/test/pglite/declutterBuyNowOnePage.pglite.mjs      # a planted defect: must FAIL
 *
 * Real: the lock, declutter_buy_now and sweep_deadline_reminders (this migration, or their newest earlier CREATEs
 * when skipped), declutter_make_offer (its newest CREATE). Stubbed, said so: require_feature, is_caller_banned,
 * declutter_assert_member (returns the caller), are_users_blocked / declutter_seller_out / seed_hidden_for (false),
 * declutter_take_item (reserves the item and writes a 30-minute 'buy' line, its contract), declutter_notify_strict
 * (writes the bell row; refuses one member's row when test.refuse is on), log_cron_defect (records), the two other
 * reminder sweeps (0) and the free-asks sweep (7, so its half is seen to still run). Supabase's default EXECUTE grant to anon/authenticated is emulated.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261107174801_declutter_buy_now_one_page.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // Buy now keeps asking for a card (the bug).
  buyNeedsCard: ["FROM public.declutter_lock_buyable_item(p_item_id, v_uid, false);", "FROM public.declutter_lock_buyable_item(p_item_id, v_uid, true);"],
  // The 2-argument form (offers, bundles) stops asking for a card.
  wrapperNoCard: ["FROM public.declutter_lock_buyable_item(p_item_id, p_buyer, true) l;", "FROM public.declutter_lock_buyable_item(p_item_id, p_buyer, false) l;"],
  // A NULL p_need_card skips the card rule.
  nullSkips: ["IF p_need_card IS DISTINCT FROM false", "IF p_need_card"],
  // No once-only claim: every run reminds again.
  noClaim: ["         SET reminded_last_call_at = p_now\n", "         SET reminded_last_call_at = NULL\n"],
  // Seed accounts are reminded.
  seedTold: ["       AND NOT COALESCE((SELECT p.is_seed FROM public.profiles p WHERE p.user_id = c.buyer_id), false)\n", ""],
  // The sweep is not wired into the cron's function.
  notWired: ["    v_last_call := public.declutter_buy_now_last_call_sweep(p_now);", "    v_last_call := 0;"],
};
const skip = process.env.NEW_MIGRATION === "skip";

function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `99999999-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), NOCARD = U(2), CARDED = U(3), BAD = U(4), SEEDBUYER = U(5), LATE = U(6);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text, message text, link text,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.defects (fn text, ref text, msg text);
CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text, p_ctx jsonb DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.defects VALUES (p_fn, p_ref, p_msg) $$;
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, title text, current_price_cents integer,
  status text DEFAULT 'live', sale_mode text DEFAULT 'offers', is_seed boolean DEFAULT false, accepts_offers boolean DEFAULT true);
CREATE TABLE public.declutter_buyer_cards (user_id uuid PRIMARY KEY);
CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, seller_id uuid,
  amount_cents integer, awaiting text, respond_by timestamptz, status text DEFAULT 'open', created_at timestamptz DEFAULT now());
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, item_id uuid,
  price_cents integer, source text, status text DEFAULT 'in_cart', created_at timestamptz DEFAULT now(), checkout_by timestamptz);
CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_assert_member(b boolean) RETURNS uuid LANGUAGE sql AS $$ SELECT auth.uid() $$;
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_seller_out(a uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.seed_hidden_for(a uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_take_item(p_item_id uuid, p_buyer uuid, p_price integer, p_source text, p_offer_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.declutter_items SET status = 'reserved' WHERE id = p_item_id;
  INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, checkout_by)
  SELECT p_item_id, p_buyer, i.seller_id, p_price, p_source, now() + interval '30 minutes' FROM public.declutter_items i WHERE i.id = p_item_id
  RETURNING id $$;
CREATE FUNCTION public.declutter_notice_ref(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.declutter_notify_strict(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_user = '${BAD}' AND current_setting('test.refuse', true) = 'on' THEN RAISE EXCEPTION 'notice refused'; END IF;
  INSERT INTO public.notifications (user_id, type, title, message, link) VALUES (p_user, p_type, p_title, p_message, p_link);
END $$;
CREATE FUNCTION public.declutter_book_by_reminder_sweep(p timestamptz) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.sweep_needs_you_reminders(p timestamptz) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.sweep_declutter_free_asks(p timestamptz) RETURNS integer LANGUAGE sql AS $$ SELECT 7 $$;
`);
for (const fn of ["declutter_lock_buyable_item", "declutter_buy_now", "declutter_make_offer", "sweep_deadline_reminders"]) {
  await db.exec(definitionBefore(fn, THIS));
}

if (!skip) {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  if (MUTANT) {
    const m = MUTANTS[MUTANT];
    if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
    mig = mig.replace(m[0], m[1]);
  }
  for (let k = 1; k <= 3; k++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${k})`); } catch (e) { check(false, `the migration applies (run ${k}): ${e.message}`); }
  }
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
async function as(uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
for (const u of [SELLER, NOCARD, CARDED, BAD, LATE]) await q(`INSERT INTO public.profiles (user_id) VALUES ($1)`, [u]);
await q(`INSERT INTO public.profiles (user_id, is_seed) VALUES ($1, true)`, [SEEDBUYER]);
await q(`INSERT INTO public.declutter_buyer_cards (user_id) VALUES ($1)`, [CARDED]);
const item = async (title, price = 4000, seed = false) =>
  (await q(`INSERT INTO public.declutter_items (seller_id, title, current_price_cents, is_seed) VALUES ($1, $2, $3, $4) RETURNING id`,
    [SELLER, title, price, seed]))[0].id;

// 1. Buy now without a saved card.
const lamp = await item("Lamp");
const bought = await as(NOCARD, `SELECT public.declutter_buy_now('${lamp}', 4000) AS id`);
check(Array.isArray(bought) && !!bought[0]?.id, `[fix] Buy now with no saved card holds the item (${JSON.stringify(bought)})`);
check((await q(`SELECT status FROM public.declutter_items WHERE id = $1`, [lamp]))[0].status === "reserved", "[fix] and the item is reserved for the buyer");

// 2. Offers (and every 2-argument lock caller) still need a card.
const desk = await item("Desk");
const offered = await as(NOCARD, `SELECT public.declutter_make_offer('${desk}', 3000) AS id`);
check(!Array.isArray(offered) && /card_required/.test(offered.error), `an offer with no saved card is still refused card_required (${JSON.stringify(offered)})`);
check(Number((await q(`SELECT count(*) AS n FROM public.declutter_offers`))[0].n) === 0, "and no offer row was written");
const lock2 = await q(`SELECT public.declutter_lock_buyable_item('${desk}', '${NOCARD}') AS r`).catch((e) => ({ error: e.message }));
check(!Array.isArray(lock2) && /card_required/.test(lock2.error), `the 2-argument lock (bundles) still refuses no card (${JSON.stringify(lock2)})`);
const lock2ok = await q(`SELECT (public.declutter_lock_buyable_item('${desk}', '${CARDED}')).o_price_cents AS p`).catch((e) => ({ error: e.message }));
check(Array.isArray(lock2ok) && lock2ok[0].p === 4000, `the 2-argument lock passes a buyer with a card and returns the item (${JSON.stringify(lock2ok)})`);
if (!skip) {
  const lockNull = await q(`SELECT public.declutter_lock_buyable_item('${desk}', '${NOCARD}', NULL) AS r`).catch((e) => ({ error: e.message }));
  check(!Array.isArray(lockNull) && /card_required/.test(lockNull.error), `a NULL p_need_card fails closed (${JSON.stringify(lockNull)})`);
  const acl = (await q(`SELECT has_function_privilege('anon', 'public.declutter_lock_buyable_item(uuid,uuid,boolean)', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.declutter_lock_buyable_item(uuid,uuid,boolean)', 'EXECUTE') u,
    has_function_privilege('authenticated', 'public.declutter_lock_buyable_item(uuid,uuid)', 'EXECUTE') u2,
    has_function_privilege('authenticated', 'public.declutter_buy_now_last_call_sweep(timestamptz)', 'EXECUTE') s1,
    has_function_privilege('anon', 'public.declutter_buy_now_last_call_sweep(timestamptz)', 'EXECUTE') s2,
    has_function_privilege('authenticated', 'public.declutter_buy_now(uuid,integer)', 'EXECUTE') b,
    has_function_privilege('anon', 'public.declutter_buy_now(uuid,integer)', 'EXECUTE') b2`))[0];
  check(!acl.a && !acl.u && !acl.u2 && !acl.s1 && !acl.s2 && acl.b && !acl.b2, `grants: locks and sweep service-only, buy_now members only (${JSON.stringify(acl)})`);
}

// 3. The reminder. Lines: due now (8 min left), too early (20 min), too late (1 min), a second line of the same buyer
// and seller (one notice for both), a seed item, a seed buyer, an offer-hold line, and one whose notice is refused.
const line = async (buyer, title, minutesLeft, { source = "buy", price = 2000, seed = false } = {}) =>
  (await q(`INSERT INTO public.declutter_cart_items (buyer_id, seller_id, item_id, price_cents, source, checkout_by)
            VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6)) RETURNING id`,
           [buyer, SELLER, await item(title, price, seed), price, source, minutesLeft]))[0].id;
await q(`DELETE FROM public.declutter_cart_items`);
const due = await line(NOCARD, "Chair", 8);
const due2 = await line(NOCARD, "Stool", 9);
const early = await line(CARDED, "Table", 20);
const late = await line(LATE, "Rug", 1);
await line(CARDED, "Seed vase", 8, { seed: true });
await line(SEEDBUYER, "Bowl", 8);
await line(CARDED, "Offer lamp", 8, { source: "offer" });
const bad = await line(BAD, "Mirror", 8);
const bells = async (u) => (await q(`SELECT title, message, link FROM public.notifications WHERE user_id = $1`, [u]));
const sweep = async () => {
  const r = await q(`SELECT public.sweep_deadline_reminders() AS j`);
  return r[0].j;
};
await q(`SELECT set_config('test.refuse', 'on', false)`);
const run1 = await sweep();
const mine = await bells(NOCARD);
check(mine.length === 1 && mine[0].title === "Pay soon to keep your item", `[fix] the buyer gets ONE reminder for the hold ending soon (${JSON.stringify(mine)})`);
check(mine[0]?.message?.includes('"Chair" and 1 more are held for you until') && mine[0]?.link === "/declutter?view=cart", `[fix] it names the item and opens checkout (${mine[0]?.message})`);
check((await bells(CARDED)).length === 0, "no reminder for a hold 20 minutes out, a seed item or an offer hold");
check((await bells(LATE)).length === 0, "no reminder with under 2 minutes left");
check((await bells(SEEDBUYER)).length === 0, "[fix] a seed (test) account is never reminded");
// Skipped migration: the column does not exist, so nothing counts as claimed (null).
const claimed = async (id) => (await q(`SELECT reminded_last_call_at IS NOT NULL AS c FROM public.declutter_cart_items WHERE id = $1`, [id]).catch(() => []))[0]?.c ?? null;
check((await claimed(bad)) === false && (await bells(BAD)).length === 0, "[fix] a refused notice leaves its claim empty");
check((await q(`SELECT count(*) AS n FROM public.defects WHERE fn = 'declutter_buy_now_last_call_sweep'`))[0].n == 1, "[fix] and is logged");
check(run1?.buy_now_last_call === 1, `[fix] sweep_deadline_reminders runs it and counts what was sent (${JSON.stringify(run1)})`);
check(run1?.free_asks === 7 && run1?.book_by === 0 && run1?.needs_you === 0 && !run1?.failed, `the three earlier halves still run (book_by, needs_you, free_asks: ${JSON.stringify(run1)})`);
check((await claimed(due)) && (await claimed(due2)) && !(await claimed(early)) && !(await claimed(late)), "[fix] both lines of that hold are marked, the others not");

await q(`SELECT set_config('test.refuse', 'off', false)`);
const run2 = await sweep();
check((await bells(NOCARD)).length === 1, `[fix] the next run does not remind again (${(await bells(NOCARD)).length})`);
check((await bells(BAD)).length === 1 && (await claimed(bad)), "[fix] the refused one is sent on the next run");
check(run2?.buy_now_last_call === 1, `run 2 sends only that one (${JSON.stringify(run2)})`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/**
 * PGlite proof for 20261016053541_declutter_wanted_price_hint (Declutter wanted
 * posts + fair-price hint; docs/specs/declutter-wanted-price-hint.md, W1-W12),
 * on top of slices 1-4 (+ the $1,000 cap and F1), the new migration applied 3x.
 *
 *   node src/test/pglite/declutterWantedPriceHint.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/declutterWantedPriceHint.pglite.mjs   # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterWantedPriceHint.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { setupStatements, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, BUYER, BUYER2, BUYER3, SELLER2, SELLER3, OUTSIDER, MINOR, BANNED, ADMIN, STRUCK, NOCARD, NOPAYOUT } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";
const WANTED_FILE = "20261016053541_declutter_wanted_price_hint.sql";

/** A fresh prod-shaped database: slices 1-4, then the new migration 3x. */
async function fresh() {
  const d = new PGlite();
  // Live columns of notification_preferences the migration reads (new_offers; unset row = on).
  await d.exec(`CREATE TABLE IF NOT EXISTS public.notification_preferences (user_id uuid UNIQUE, new_offers boolean NOT NULL DEFAULT true);`);
  // log_cron_defect (20261004004835) records a cron failure; here it keeps a row to assert on.
  await d.exec(`CREATE TABLE IF NOT EXISTS public.cron_defects (fn text, ref text, err text);
    CREATE OR REPLACE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE sql AS $f$ INSERT INTO public.cron_defects VALUES (a, b, c) $f$;`);
  const extra = [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 }];
  if (!skip) extra.push(process.env.MIGRATION_PATH ? { path: process.env.MIGRATION_PATH, times: 3 } : { file: WANTED_FILE, times: 3 });
  for (const sql of setupStatements({ times: 1, times3b: 1, extra })) await d.exec(sql);
  await d.exec(CARDS_SQL);
  return d;
}
let db = await fresh();

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
const ex = async (sql) => { try { await db.exec(sql); return []; } catch (e) { return { error: String(e.message ?? e) }; } };
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
  try { await db.exec(`SET ROLE anon;`); return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e) }; } finally { await db.exec(`RESET ROLE;`); }
}
const refused = (r, re) => !Array.isArray(r) && re.test(r.error);
const rows = (r) => (Array.isArray(r) ? r : []);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const I = (n) => `66666666-0000-0000-0000-${String(n).padStart(12, "0")}`;
const notes = async (uid, like = "%") => Number(one(await svc(
  `SELECT count(*) FROM public.notifications WHERE user_id = '${uid}' AND (title LIKE '${like}' OR message LIKE '${like}')`)));

/** A live listing (as publish leaves it) with the given fields; the go-live trigger queues it, then the cron runs (sweep: false to hold it). */
// seed-policy: not prod (throwaway PGlite only)
async function item({ n, seller = SELLER, title, desc = "Good shape.", category = "baby_kids", stars = 4, price = 6000, floor = 4000, lat = 30.45, lng = -91.15, sweep = true }) {
  const r = await ex(`
    INSERT INTO public.declutter_items (id, seller_id, status, title, description, category, condition_stars, delivery_size,
      price_cents, current_price_cents, area_label, area_lat, area_lng, live_at, submitted_at, admin_approved_at)
    VALUES ('${I(n)}', '${seller}', 'draft', '${title}', '${desc}', '${category}', ${stars}, 'small', ${price}, ${price},
      'Mid-City, Baton Rouge', ${lat}, ${lng}, NULL, NULL, now());
    INSERT INTO public.declutter_item_private (item_id, seller_id, floor_price_cents, pickup_address, pickup_lat, pickup_lng)
    VALUES ('${I(n)}', '${seller}', ${floor}, '1234 Example St, Baton Rouge, LA 70806', ${lat}, ${lng});
    UPDATE public.declutter_items SET status = 'live', live_at = now(), submitted_at = now() WHERE id = '${I(n)}';`);
  if (!Array.isArray(r)) console.log("item setup error", n, r.error);
  if (sweep) await svc(`SELECT public.declutter_wanted_sweep()`);
}
const sellerAlert = (title, max) => `Someone near you wants an item like your "${title}" for ${max} or less.`;
const want = (uid, what, { category = "baby_kids", max = 5000, radius = 10, lat = 30.45, lng = -91.16 } = {}) =>
  me(uid, `SELECT public.declutter_create_wanted('${what.replace(/'/g, "''")}', '${category}', ${max}, ${radius}, ${lat}, ${lng}) AS id`);

// ---------------------------------------------------------------------------
// A. The switches (W1).
ok(one(await svc(`SELECT audience FROM public.feature_switches WHERE key = 'declutter_wanted'`)) === "testers",
  "the 'declutter_wanted' switch is created at testers (never everyone)");
ok(one(await svc(`SELECT audience FROM public.feature_switches WHERE key = 'declutter_price_hint'`)) === "testers",
  "the 'declutter_price_hint' switch is created at testers");
ok(refused(await want(OUTSIDER, "crib"), /feature_disabled/), "a member the switch is off for cannot post (server refuses, not just the app)");
ok(refused(await me(OUTSIDER, `SELECT * FROM public.declutter_my_wanted()`), /feature_disabled/), "nor list wanted posts");
ok(refused(await me(OUTSIDER, `SELECT * FROM public.declutter_price_hint('baby_kids', 4, 30.45, -91.15)`), /feature_disabled/),
  "nor read the price hint");
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter_wanted'`);
ok(refused(await want(BUYER, "crib"), /feature_disabled/), "with 'declutter_wanted' off even a tester is refused");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter_wanted'`);
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter'`);
ok(refused(await want(BUYER, "crib"), /feature_disabled/), "with 'declutter' itself off a tester is refused too");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter'`);
ok(refused(await anon(`SELECT public.declutter_create_wanted('crib', 'baby_kids', 5000, 10, 30.45, -91.16)`), /permission denied/),
  "anon cannot call the RPCs (REVOKE ... FROM PUBLIC, anon)");
for (const f of ["declutter_wanted_sweep()", `declutter_wanted_match_item('${I(1)}')`]) {
  ok(refused(await me(BUYER, `SELECT public.${f}`), /permission denied/), `a member cannot run ${f.split("(")[0]} (service only)`);
}

// ---------------------------------------------------------------------------
// B. Posting: gates and input (W4, W7, W8).
ok(refused(await want(MINOR, "crib"), /under_18/), "under 18 cannot post (row 53: a wanted post is a buying intent)");
ok(refused(await want(BANNED, "crib"), /account_restricted/), "a banned member cannot post");
ok(refused(await want(BUYER, "call me 225-555-0199"), /check constraint|phone|contact|invalid_wanted_text/i), "a phone number is refused");
ok(refused(await want(BUYER, "crib 5 0 4 5 5 5 1 2 1 2"), /invalid_wanted_text/), "a phone number spaced out digit by digit is refused");
ok(refused(await want(BUYER, "crib five zero four five"), /invalid_wanted_text/), "a phone number in words is refused");
ok(refused(await want(BUYER, "crib ｃａｓｈａｐｐ"), /invalid_wanted_text/), "fullwidth or other non-ASCII letters are refused");
ok(refused(await want(BUYER, "crib at example.com"), /invalid_wanted_text|contact|link/i), "a web address is refused");
ok(refused(await want(BUYER, "!!!"), /invalid_wanted_text/), "symbols only are refused");
ok(refused(await want(BUYER, "the and"), /invalid_wanted_text/), "stop words only (nothing searchable) are refused");
ok(refused(await want(BUYER, "crib", { max: 100001 }), /invalid_max_price/), "a highest price over $1,000 is refused");
ok(refused(await want(BUYER, "crib", { max: 1488 }), /invalid_max_price/), "a highest price with cents is refused (whole dollars only)");
ok(refused(await want(BUYER, "crib", { radius: 7 }), /invalid_radius/), "a distance not on the list is refused");
ok(refused(await want(BUYER, "crib", { category: "Bad Cat" }), /invalid_category/), "a malformed category is refused");
ok(refused(await me(BUYER, `SELECT public.declutter_create_wanted('crib', 'baby_kids', 5000, 10, NULL, -91.16)`), /wanted_area_unknown/),
  "no area: refused in words the poster can act on");

// ---------------------------------------------------------------------------
// C. A post tells sellers of live matches now (W5, W6, W15).
await item({ n: 1, title: "White baby crib", price: 6000, floor: 4000 });          // floor <= $50: seller told
await item({ n: 2, seller: SELLER2, title: "Wood crib", price: 7000, floor: 6000 }); // floor > $50: not told
await item({ n: 3, seller: SELLER2, title: "Crib far away", price: 3000, floor: 2000, lat: 32.5, lng: -93.75 }); // Shreveport
await item({ n: 4, seller: SELLER2, title: "Baby stroller", price: 3000, floor: 2000 });            // words differ
await item({ n: 5, seller: SELLER2, title: "Crib bedding set", category: "home_decor", price: 2000, floor: 1000 }); // category differs
await item({ n: 6, seller: OUTSIDER, title: "Small crib", price: 3000, floor: 2000 });               // switch off for this seller
await item({ n: 7, seller: SELLER2, title: "Cribs for twins", price: 4500, floor: 3000 });          // stemmed match, priced under
const w1 = one(await want(BUYER, "crib"));
ok(typeof w1 === "string", "a tester posts 'crib, baby and kids, $50, 10 mi'");
ok(await notes(SELLER, "Someone near you wants%") === 1, "the seller whose floor an offer at $50 clears is told once");
ok(rows(await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER}' AND title LIKE 'Someone near you wants%'`))[0]?.message
   === sellerAlert("White baby crib", "$50"),
  "in plain words naming the SELLER's own listing and the price, never the poster's own words (W15)");
ok(Number(one(await svc(`SELECT count(*) FROM public.notifications WHERE message LIKE '%wants crib%'`))) === 0,
  "the poster's text appears in no notification");
ok(await notes(SELLER2, "Someone near you wants%") === 1, "the seller of 'Cribs for twins' (stemmed match) is told; their other listings are not");
ok(await notes(OUTSIDER, "Someone near you wants%") === 0, "a seller the switch is off for is never told");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_wanted_matches WHERE wanted_id = '${w1}'`))) === 4,
  "the matches recorded: items 1, 2, 6 and 7 (not the far one, not the stroller, not the other category)");
const mine = rows(await me(BUYER, `SELECT * FROM public.declutter_my_wanted()`));
ok(mine.length === 1 && mine[0].status === "open" && JSON.stringify(mine[0].matches.map((m) => m.id)) === JSON.stringify([I(6), I(7)])
   && mine[0].matches[1].title === "Cribs for twins" && mine[0].matches[1].price_cents === 4500,
  "the poster sees the live matches at or under $50 now with title and price ($30, $45), cheapest first, not the $60 and $70 ones");
ok(await notes(BUYER, "A match for%") === 0, "the poster is not sent alerts about matches already on their screen");

// ---------------------------------------------------------------------------
// D. A listing that goes live later: queued by the trigger, matched by the cron (W5, W6).
await item({ n: 8, seller: SELLER2, title: "Pack and play crib", price: 4000, floor: 3500, sweep: false });
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_wanted_queue WHERE item_id = '${I(8)}'`))) === 1
   && await notes(BUYER, "A match for%") === 0,
  "going live only queues the listing: no alert work inside the publish transaction");
const sw = one(await svc(`SELECT public.declutter_wanted_sweep() AS r`));
ok(sw?.items === 1 && sw?.failed === 0 && Number(one(await svc(`SELECT count(*) FROM public.declutter_wanted_queue`))) === 0,
  "the cron drains the queue and reports what it did");
ok(await notes(BUYER, "A match for%") === 1, "a new match at or under the price tells the poster");
ok(rows(await svc(`SELECT message FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'A match for what you want'`))[0]?.message
   === `"Pack and play crib" was just listed near you for $40.`, "with the item and its price");
ok(await notes(SELLER2, "Someone near you wants%") === 1,
  "its seller is not told again: one wanted alert per poster per seller a week (they heard from this poster in C)");
await svc(`UPDATE public.declutter_items SET status = 'reserved' WHERE id = '${I(8)}'`);
await svc(`UPDATE public.declutter_items SET status = 'live' WHERE id = '${I(8)}'`);
await svc(`SELECT public.declutter_wanted_sweep()`);
ok(await notes(BUYER, "A match for%") === 1, "back on sale (reserved -> live) never alerts the same pair twice");
await item({ n: 9, seller: SELLER, title: "Travel crib", price: 9000, floor: 4500 });
ok(await notes(BUYER, "A match for%") === 1, "a new match priced over $50 does not tell the poster");
// A matcher failure is logged and retried, and never blocks the go-live.
await ex(`ALTER FUNCTION public.declutter_wanted_match_item(uuid) RENAME TO declutter_wanted_match_item_real;
  CREATE FUNCTION public.declutter_wanted_match_item(p uuid) RETURNS integer LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'planted matcher failure'; END $f$;`);
await item({ n: 14, seller: SELLER2, title: "Crib with mattress", price: 3000, floor: 2000, sweep: false });
ok(one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(14)}'`)) === "live", "with the matcher broken the listing still goes live");
const swf = one(await svc(`SELECT public.declutter_wanted_sweep() AS r`));
ok(swf?.failed === 1 && Number(one(await svc(`SELECT count(*) FROM public.cron_defects WHERE fn = 'declutter_wanted_sweep' AND ref = '${I(14)}'`))) === 1
   && Number(one(await svc(`SELECT attempts FROM public.declutter_wanted_queue WHERE item_id = '${I(14)}'`))) === 1,
  "the failure is logged as a cron defect and the item stays queued with one try counted");
await svc(`UPDATE public.declutter_wanted_queue SET attempts = 11 WHERE item_id = '${I(14)}'`);
await svc(`SELECT public.declutter_wanted_sweep()`);
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_wanted_queue WHERE item_id = '${I(14)}'`))) === 0
   && Number(one(await svc(`SELECT count(*) FROM public.cron_defects WHERE ref = '${I(14)}' AND err LIKE 'gave up after 12 tries%'`))) === 1,
  "after the 12th failed try the row is dropped and the give-up is logged in words");
await svc(`UPDATE public.declutter_items SET status = 'reserved' WHERE id = '${I(14)}'`);
await svc(`UPDATE public.declutter_items SET status = 'live' WHERE id = '${I(14)}'`);
ok(Number(one(await svc(`SELECT attempts FROM public.declutter_wanted_queue WHERE item_id = '${I(14)}'`))) === 0,
  "so a later go-live queues the listing afresh");
await ex(`DROP FUNCTION public.declutter_wanted_match_item(uuid);
  ALTER FUNCTION public.declutter_wanted_match_item_real(uuid) RENAME TO declutter_wanted_match_item;`);
await svc(`SELECT public.declutter_wanted_sweep()`);
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_wanted_queue`))) === 0 && await notes(BUYER, "A match for%") === 2,
  "the next run matches it");
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter_wanted'`);
await item({ n: 15, seller: SELLER2, title: "Crib rail", price: 1000, floor: 500 });
ok(await notes(BUYER, "A match for%") === 2 && Number(one(await svc(`SELECT count(*) FROM public.declutter_wanted_queue`))) === 0,
  "with the switch off the cron sends nothing and empties the queue");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter_wanted'`);

// ---------------------------------------------------------------------------
// E. Blocks, mutes, seed, hidden sellers, posters who lose the switch.
await svc(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${SELLER}', '${BUYER2}')`);
const sellerBefore = await notes(SELLER, "Someone near you wants%");
const w2 = one(await want(BUYER2, "crib"));
ok(typeof w2 === "string" && await notes(SELLER, "Someone near you wants%") === sellerBefore,
  "a seller who blocked the poster is not told");
ok(rows(await svc(`SELECT item_id FROM public.declutter_wanted_pairs(NULL, '${w2}', true)`)).some((r) => r.item_id === I(1))
   && !rows(await svc(`SELECT item_id FROM public.declutter_wanted_pairs(NULL, '${w2}', false)`)).some((r) => r.item_id === I(1)),
  "the blocked poster's own list still counts that seller's listing that seller's listing as a match, exactly as Browse shows it (the list never reveals a block)");
await svc(`INSERT INTO public.notification_preferences (user_id, new_offers) VALUES ('${SELLER2}', false)`);
const before2 = await notes(SELLER2, "Someone near you wants%");
const w3 = one(await want(BUYER3, "crib"));
ok(typeof w3 === "string" && await notes(SELLER2, "Someone near you wants%") === before2,
  "a seller with 'New offers' alerts off is not told");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_wanted_matches m JOIN public.declutter_items i ON i.id = m.item_id
   WHERE m.wanted_id = '${w3}' AND i.seller_id = '${SELLER2}' AND m.seller_notified_at IS NULL`))) >= 1,
  "the muted pair is recorded unstamped, so turning alerts back on never replays it");
const sellerBeforeSeed = await notes(SELLER, "%");
const seedPost = one(await want(SELLER3, "crib"));
ok(typeof seedPost === "string" && one(await svc(`SELECT is_seed FROM public.declutter_wanted WHERE id = '${seedPost}'`)) === true,
  "a test account's post is seed from birth");
ok(await notes(SELLER, "%") === sellerBeforeSeed
   && Number(one(await svc(`SELECT count(*) FROM public.declutter_wanted_matches WHERE wanted_id = '${seedPost}'`))) === 0,
  "a test (seed) post never meets a real listing: no alert and no ledger row, so it spends no real seller's cap");
// An account marked test AFTER it posted: its old, real-stamped post meets no real listing.
const lateSeed = one(await want(BUYER3, "travel crib", { max: 9000 }));
await svc(`UPDATE public.profiles SET is_seed = true WHERE user_id = '${BUYER3}'`);
await item({ n: 16, seller: SELLER, title: "Travel crib two", price: 3000, floor: 2000 });
ok(typeof lateSeed === "string" && Number(one(await svc(`SELECT count(*) FROM public.declutter_wanted_matches WHERE wanted_id = '${lateSeed}' AND item_id = '${I(16)}'`))) === 0,
  "an account marked test after it posted: its post meets no real listing (live profiles checked)");
await svc(`UPDATE public.profiles SET is_seed = false WHERE user_id = '${BUYER3}'`);
await me(BUYER3, `SELECT public.declutter_close_wanted('${lateSeed}')`);
await svc(`INSERT INTO public.declutter_strikes (user_id, offender_side, reason, given_at, expires_at)
  SELECT '${SELLER}', 'seller', 'seller_no_show', now(), now() + interval '1 year' FROM generate_series(1, 3)`);
const hidden = rows(await me(BUYER3, `SELECT * FROM public.declutter_my_wanted()`)).find((w) => w.id === w3);
ok(hidden && !hidden.matches.some((m) => m.id === I(1)), "a seller with 3 strikes is hidden: their items are not shown as matches");
await svc(`DELETE FROM public.declutter_strikes WHERE user_id = '${SELLER}'`);
await svc(`DELETE FROM public.test_accounts WHERE user_id = '${BUYER3}'`);
const s2Before = await notes(SELLER2, "%");
await svc(`DELETE FROM public.notification_preferences WHERE user_id = '${SELLER2}'`);
await item({ n: 10, seller: SELLER2, title: "Mini crib", price: 3000, floor: 2000 });
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_wanted_matches WHERE wanted_id = '${w3}' AND item_id = '${I(10)}'`))) === 0,
  "a poster the switch is no longer on for: their post matches nothing new");
await svc(`INSERT INTO public.test_accounts (user_id) VALUES ('${BUYER3}')`);
void s2Before;

// ---------------------------------------------------------------------------
// F. Caps (W7).
await svc(`DELETE FROM public.notification_preferences`);
await svc(`UPDATE public.declutter_wanted SET created_at = now() - interval '2 days' WHERE user_id = '${BUYER}'`);
for (let k = 0; k < 5; k++) ok(typeof one(await want(BUYER, `lamp ${k}`, { category: "furniture" })) === "string", `post ${k + 1} of 5 today`);
ok(refused(await want(BUYER, "lamp six", { category: "furniture" }), /wanted_rate_limited/), "a 6th post in one day is refused");
await svc(`UPDATE public.declutter_wanted SET created_at = now() - interval '2 days' WHERE user_id = '${BUYER}'`);
const openNow = Number(one(await svc(`SELECT count(*) FROM public.declutter_wanted WHERE user_id = '${BUYER}' AND status = 'open' AND expires_at > now()`)));
for (let k = openNow; k < 10; k++) await want(BUYER, `desk ${k}`, { category: "furniture" });
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_wanted WHERE user_id = '${BUYER}' AND status = 'open'`))) === 10,
  "setup: 10 open posts");
ok(refused(await want(BUYER, "rug", { category: "furniture" }), /wanted_open_limit/), "an 11th open post is refused (10 open at most)");
// A week passes: earlier alerts no longer count toward any cap.
await ex(`DELETE FROM public.notifications; UPDATE public.declutter_wanted_matches SET seller_notified_at = seller_notified_at - interval '8 days',
  poster_notified_at = poster_notified_at - interval '8 days'`);
// (BUYER2 is blocked by SELLER: no pair. MINOR's row, written around the RPC: no pair.)
for (const p of [BUYER2, BUYER3, BUYER3, BUYER3, ADMIN, SELLER2, BUYER, STRUCK, NOCARD, NOPAYOUT, MINOR]) {
  await svc(`INSERT INTO public.declutter_wanted (user_id, what, category, max_price_cents, radius_miles, area_lat, area_lng)
    VALUES ('${p}', 'toy box', 'toys_games', 3000, 10, 30.45, -91.15)`);
}
await item({ n: 11, seller: SELLER, title: "Toy box chest", category: "toys_games", price: 2000, floor: 1000 });
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_wanted_matches WHERE item_id = '${I(11)}'`))) === 9,
  "9 pairs recorded (the blocked poster's and the under-18 poster's are not)");
ok(await notes(SELLER, "Someone near you wants%") === 5,
  "a seller gets at most 5 wanted alerts a day (7 different posters matched), and 1 per poster (BUYER3 posted 3 times)");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_wanted_matches WHERE item_id = '${I(11)}' AND seller_notified_at IS NOT NULL`))) === 5,
  "and exactly the alerts written are stamped");
ok(await notes(MINOR, "A match for%") === 0 && await notes(BUYER2, "A match for%") === 0,
  "neither the under-18 poster nor the blocked poster gets a match alert");
ok(await notes(ADMIN, "A match for%") === 1, "an eligible poster is told about the $20 toy box");
ok(Number(one(await svc(`SELECT public.declutter_wanted_match_item('${I(11)}')`))) === 0,
  "re-running the matcher on the same item sends nothing (each pair once)");

// ---------------------------------------------------------------------------
// G. Closing and reading (RLS).
ok(refused(await me(BUYER2, `SELECT public.declutter_close_wanted('${w1}')`), /wanted_not_found/),
  "a member cannot close someone else's post (not told it exists)");
ok(one(await me(BUYER, `SELECT public.declutter_close_wanted('${w1}')`)) === "closed", "the poster closes their own post");
ok(one(await svc(`SELECT status FROM public.declutter_wanted WHERE id = '${w1}'`)) === "closed", "it reads closed");
await item({ n: 12, seller: SELLER2, title: "Folding crib", price: 2000, floor: 1500 });
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_wanted_matches WHERE wanted_id = '${w1}' AND item_id = '${I(12)}'`))) === 0,
  "a closed post matches nothing new");
await svc(`UPDATE public.declutter_wanted SET expires_at = now() - interval '1 minute' WHERE id = '${w2}'`);
await item({ n: 13, seller: SELLER2, title: "Crib mattress crib", price: 2000, floor: 1500 });
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_wanted_matches WHERE wanted_id = '${w2}' AND item_id = '${I(13)}'`))) === 0,
  "an expired post (30 days) matches nothing new");
const b2 = rows(await me(BUYER2, `SELECT * FROM public.declutter_my_wanted()`));
ok(b2.find((w) => w.id === w2)?.status === "expired", "and reads 'expired' to its poster");
ok(b2[0]?.status === "open", "open posts list first");
ok(rows(await me(BUYER2, `SELECT id FROM public.declutter_wanted`)).every((r) => r.id !== w1),
  "a member reads only their own wanted posts (RLS)");
for (const t of ["declutter_wanted_matches", "declutter_wanted_queue"]) {
  ok(refused(await me(BUYER, `SELECT * FROM public.${t}`), /permission denied/), `no member reads ${t}`);
}
ok(refused(await me(BUYER, `INSERT INTO public.declutter_wanted (user_id, what, category, max_price_cents, radius_miles, area_lat, area_lng)
  VALUES ('${BUYER}', 'crib', 'baby_kids', 5000, 10, 30.45, -91.15)`), /permission denied/), "no member writes the table directly");

// ---------------------------------------------------------------------------
// H. The fair-price hint (W9-W12), on a fresh database: real completed sales only,
//    at least 11 buyer-seller pairs, 3+ sellers and 3+ buyers.
db = await fresh();
let n = 100;
async function sale(buyer, seller, price, { category = "furniture", stars = 3, lat = 30.45, lng = -91.15, seed = false } = {}) {
  n++;
  await item({ n, seller, title: `Sold dresser ${n}`, category, stars, price, floor: Math.min(price, 100), lat, lng, sweep: false });
  if (seed) await svc(`UPDATE public.declutter_items SET is_seed = true WHERE id = '${I(n)}'`);
  const b = await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  const o = rows(await me(buyer, `SELECT * FROM public.declutter_start_checkout('${seller}', 'pickup_home')`))[0];
  if (!o) console.log("sale setup failed", n, b, o);
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_wh_${n}', ${o?.total_cents}, now(), 150)`);
  const h = await me(buyer, `SELECT public.declutter_confirm_handover('${o?.order_id}', 'buyer', NULL) AS r`);
  if (one(h)?.result !== "handed_over") console.log("handover setup failed", n, JSON.stringify(h));
  return o?.order_id;
}
const hint = (cat = "furniture", stars = 3, lat = 30.45, lng = -91.15, uid = BUYER) =>
  me(uid, `SELECT * FROM public.declutter_price_hint('${cat}', ${stars}, ${lat}, ${lng})`);
const SELLERS4 = [SELLER, SELLER2, ADMIN, NOCARD];
const BUYERS4 = [BUYER, BUYER2, BUYER3, STRUCK];
const PAIRS = SELLERS4.flatMap((s2) => BUYERS4.map((b) => [b, s2]));
const PRICES = [4000, 4200, 4500, 4800, 5000, 5200, 5500, 6000, 6500, 7000];
for (let k = 0; k < 10; k++) await sale(PAIRS[k][0], PAIRS[k][1], PRICES[k]);
ok(rows(await hint()).length === 0, "10 completed sales: no hint (never shown under 11)");
await sale(PAIRS[0][0], PAIRS[0][1], 9900);
ok(rows(await hint()).length === 0, "an 11th sale between a pair that already traded does not count (one per pair)");
await sale(PAIRS[10][0], PAIRS[10][1], 99900, { seed: true });
ok(rows(await hint()).length === 0, "a seed (test) sale does not count");
await sale(PAIRS[10][0], PAIRS[10][1], 5500, { stars: 5 });
await sale(PAIRS[10][0], PAIRS[10][1], 5500, { category: "tools" });
await sale(PAIRS[10][0], PAIRS[10][1], 5500, { lat: 32.5, lng: -93.75 });
ok(rows(await hint()).length === 0, "sales of another condition, category, or over 25 miles away do not count");
const old = await sale(PAIRS[11][0], PAIRS[11][1], 5200);
await svc(`UPDATE public.declutter_orders SET handed_over_at = now() - interval '400 days' WHERE id = '${old}'`);
ok(rows(await hint()).length === 0, "a sale handed over more than a year ago does not count");
await item({ n: 900, seller: PAIRS[12][1], title: "Paid not handed", category: "furniture", stars: 3, price: 5100, floor: 100, sweep: false });
await me(PAIRS[12][0], `SELECT public.declutter_buy_now('${I(900)}', 5100)`);
ok(rows(await hint()).length === 0, "an agreed but not handed-over sale does not count");
await sale(PAIRS[13][0], PAIRS[13][1], 100);
const h11 = rows(await hint());
ok(h11.length === 1, "11 real sales between 11 different pairs: the hint answers");
// Counted: one per pair, the latest (the first pair's $99 replaced its $40), plus the $1: 1, 42, 45, ..., 70, 99.
ok(h11[0]?.low_cents === 4000 && h11[0]?.high_cents === 7000,
  `the 10th-90th percentile, rounded outward to $5: the $1 and $99 sales fall outside ($40-$70; got ${JSON.stringify(h11[0])})`);
ok(h11[0]?.sales === 10, "the count comes back in tens (11 -> 10, shown as '10+')");
ok(rows(await hint("furniture", 3, 30.46, -91.16)).length === 1, "a point a mile away gets the same hint");
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${NOCARD}'`);
ok(rows(await hint()).length === 0, "a banned side's sales stop counting (drops it under 11)");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${NOCARD}'`);
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter_price_hint'`);
ok(refused(await hint(), /feature_disabled/), "with 'declutter_price_hint' off the hint is refused");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter_price_hint'`);
ok(rows(await me(BUYER, `SELECT * FROM public.declutter_price_hint('furniture', NULL, 30.45, -91.15)`)).length === 0,
  "a missing condition gives no hint (never a guess)");
ok(refused(await anon(`SELECT * FROM public.declutter_price_hint('furniture', 3, 30.45, -91.15)`), /permission denied/),
  "anon cannot read the hint");
// The spread rule: 12 pairs but only 2 sellers, or only 2 buyers, is not enough.
const B6 = [BUYER, BUYER2, BUYER3, STRUCK, SELLER, SELLER2];
for (const b of B6) for (const s2 of [ADMIN, NOCARD]) await sale(b, s2, 3000, { category: "tools", stars: 2 });
ok(rows(await hint("tools", 2)).length === 0, "12 sales from only 2 different sellers: no hint (a seller and friends cannot set it)");
await sale(SELLER, BUYER, 3000, { category: "tools", stars: 2 });
ok(rows(await hint("tools", 2)).length === 1, "a third seller: the hint answers");
const S6 = [SELLER, SELLER2, ADMIN, NOCARD, BUYER3, STRUCK];
for (const s2 of S6) for (const b of [BUYER, BUYER2]) await sale(b, s2, 1500, { category: "toys_games", stars: 1 });
ok(rows(await hint("toys_games", 1)).length === 0, "12 sales to only 2 different buyers: no hint");
await sale(BUYER3, SELLER, 1500, { category: "toys_games", stars: 1 });
ok(rows(await hint("toys_games", 1))[0]?.low_cents === 1500, "a third buyer: the hint answers ($15)");

// ---------------------------------------------------------------------------
// I. Download My Data carries the member's posts. (The whole export reads ~150
//    prod tables this harness does not build, so the deployed body is checked:
//    the section exists and is scoped to the member.)
const src = String(one(await svc(`SELECT prosrc FROM pg_proc WHERE proname = 'export_my_data'`)) ?? "");
ok(/'declutter_wanted',\s*\(SELECT[^;]*FROM public\.declutter_wanted t\s+WHERE t\.user_id = v_uid\)/.test(src),
  "export_my_data has a declutter_wanted section with only the member's own posts");
ok(/'category_suggestions'/.test(src) && /'declutter_reviews'/.test(src), "and keeps every section the newest body had");
ok(!/declutter_wanted_matches/.test(src), "and never the match ledger (a hidden-floor oracle to the poster)");

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(fail === 0 ? 0 : 1);

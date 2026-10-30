#!/usr/bin/env node
/**
 * PGlite proof for 20261030161617_declutter_pickup_on_my_way.sql (D-NEW11: "I'm on my way").
 *
 *   node src/test/pglite/declutterOnMyWay.pglite.mjs                # after (3x replay)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterOnMyWay.pglite.mjs   # before: must FAIL
 *   MUTANT=<name> node src/test/pglite/declutterOnMyWay.pglite.mjs  # a planted defect: must FAIL
 *
 * World: the columns the function reads, the migration verbatim. Stubbed, and said so: auth.uid() (a test setting),
 * is_caller_banned (a table), declutter_lock_order (reads the order; the real one also locks the items) and
 * declutter_notify (records the notice).
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = "20261030161617_declutter_pickup_on_my_way.sql";
const SKIP = process.env.NEW_MIGRATION === "skip";
const MUTANT = process.env.MUTANT ?? "";

const MUTANTS = {
  // Anyone on the order, or anyone at all, can send it.
  buyer: ["  IF o.buyer_id IS DISTINCT FROM v_uid THEN\n    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';\n  END IF;\n", ""],
  // Any day will do.
  day: ["  IF v_day <> v_today THEN", "  IF false THEN"],
  // Every tap notifies the seller again.
  once: ["  IF b.buyer_on_way_at IS NOT NULL AND (b.buyer_on_way_at AT TIME ZONE 'America/Chicago')::date = v_today THEN", "  IF false THEN"],
  // Yesterday's tap silences today's pickup.
  yesterday: ["AND (b.buyer_on_way_at AT TIME ZONE 'America/Chicago')::date = v_today THEN", "THEN"],
  // A delivered order can say it.
  kinds: ["o.handover NOT IN ('pickup_home', 'porch', 'meetup')", "false"],
  // A finished order can say it.
  status: ["o.status <> 'paid' OR ", ""],
  // Nothing booked is fine.
  booked: ["  IF v_day IS NULL THEN", "  IF false THEN"],
  // A banned member can send it.
  banned: ["  IF public.is_caller_banned() THEN", "  IF false THEN"],
  // The notice goes to the buyer.
  target: ["PERFORM public.declutter_notify(o.seller_id,", "PERFORM public.declutter_notify(o.buyer_id,"],
  // The time is not noted.
  noted: ["  UPDATE public.declutter_bookings SET buyer_on_way_at = now(), updated_at = now() WHERE order_id = o.id;\n", ""],
  // Anon may call it.
  grant: ["REVOKE ALL ON FUNCTION public.declutter_on_my_way(uuid) FROM PUBLIC, anon;", ""],
};
if (MUTANT && !MUTANTS[MUTANT]) throw new Error(`unknown MUTANT ${MUTANT}`);
let sql = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  if (!sql.includes(MUTANTS[MUTANT][0])) throw new Error(`mutant ${MUTANT}: anchor gone`);
  sql = sql.replace(MUTANTS[MUTANT][0], MUTANTS[MUTANT][1]);
}

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
  CREATE TABLE public.test_banned (id uuid PRIMARY KEY);
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS (SELECT 1 FROM public.test_banned b WHERE b.id = auth.uid()) $f$;
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, status text, handover text, handed_over_at timestamptz);
  CREATE TABLE public.declutter_bookings (order_id uuid PRIMARY KEY, slot_start timestamptz, pickup_day date, updated_at timestamptz);
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, title text);
  CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, item_id uuid);
  CREATE TABLE public.test_notices (user_id uuid, type text, title text, message text, link text, other uuid);
  CREATE FUNCTION public.declutter_lock_order(p uuid) RETURNS public.declutter_orders LANGUAGE plpgsql AS $f$
    DECLARE o public.declutter_orders; BEGIN
      SELECT * INTO o FROM public.declutter_orders WHERE id = p FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002'; END IF;
      RETURN o; END $f$;
  CREATE FUNCTION public.declutter_notify(a uuid, b text, c text, d text, e text, f uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
    $f$ INSERT INTO public.test_notices VALUES (a, b, c, d, e, f) $f$;
`);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(sql);
else await db.exec(`ALTER TABLE public.declutter_bookings ADD COLUMN buyer_on_way_at timestamptz;`);

let passed = 0;
let failed = 0;
function check(ok, label) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (ok) passed++; else failed++;
}
const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const O = (n) => `10000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const BUYER = U(1); const SELLER = U(2); const STRANGER = U(3);
let nextOrder = 1;
async function order({ handover = "pickup_home", status = "paid", slot = "now()", day = "NULL", titles = ["Oak dresser"] } = {}) {
  const id = O(nextOrder++);
  await db.query(`INSERT INTO public.declutter_orders (id, buyer_id, seller_id, status, handover) VALUES ($1, $2, $3, $4, $5)`, [id, BUYER, SELLER, status, handover]);
  await db.query(`INSERT INTO public.declutter_bookings (order_id, slot_start, pickup_day) VALUES ($1, ${slot}, ${day})`, [id]);
  for (const [k, t] of titles.entries()) {
    const item = `20000000-0000-0000-${String(nextOrder).padStart(4, "0")}-0000000000${String(k).padStart(2, "0")}`;
    await db.query(`INSERT INTO public.declutter_items VALUES ($1, $2)`, [item, t]);
    await db.query(`INSERT INTO public.declutter_cart_items (order_id, item_id) VALUES ($1, $2)`, [id, item]);
  }
  return id;
}
async function say(id, who = BUYER) {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [who ?? ""]);
  try {
    return (await db.query(`SELECT public.declutter_on_my_way($1) AS r`, [id])).rows[0].r;
  } catch (e) {
    return `ERR:${e.message}`;
  }
}
const notices = async (like) => (await db.query(`SELECT * FROM public.test_notices WHERE message LIKE $1`, [like])).rows;

const NOON = "(date_trunc('day', now() AT TIME ZONE 'America/Chicago') + interval '12 hours') AT TIME ZONE 'America/Chicago'";
const a = await order({ slot: NOON });
const before = (await db.query(`SELECT to_jsonb(o) j FROM public.declutter_orders o WHERE id = $1`, [a])).rows[0].j;
check(await say(a) === "on_way", "the buyer, on the booked day: told");
const n1 = await notices("%Oak dresser%");
check(n1.length === 1, `the seller gets one notice (${n1.length})`);
check(n1[0]?.user_id === SELLER && n1[0]?.title === "Your buyer is on the way", "to the seller, in plain words");
check(n1[0]?.link === "/declutter?view=selling", "linking to their selling tab");
const noted = (await db.query(`SELECT buyer_on_way_at FROM public.declutter_bookings WHERE order_id = $1`, [a])).rows[0].buyer_on_way_at;
check(noted !== null, "the time is noted");
check(await say(a) === "already", "a second tap: already");
check((await notices("%Oak dresser%")).length === 1, "and no second notice");
const after = (await db.query(`SELECT to_jsonb(o) j FROM public.declutter_orders o WHERE id = $1`, [a])).rows[0].j;
check(JSON.stringify(before) === JSON.stringify(after), "the order is untouched: no status, no money, no handover");

check(await say(a, STRANGER) === "ERR:item_not_found", "a stranger: item_not_found");
check(await say(a, SELLER) === "ERR:item_not_found", "the seller: item_not_found");
check(await say(a, null) === "ERR:not_authenticated", "signed out: not_authenticated");
await db.query(`INSERT INTO public.test_banned VALUES ($1)`, [STRANGER]);
const banned = await order({ slot: NOON });
await db.query(`UPDATE public.declutter_orders SET buyer_id = $1 WHERE id = $2`, [STRANGER, banned]);
check(await say(banned, STRANGER) === "ERR:account_restricted", "a banned buyer: account_restricted");

check(await say(await order({ handover: "delivery", slot: NOON })) === "ERR:not_a_pickup", "a Helpr delivery: not_a_pickup");
check(await say(await order({ status: "handed_over", slot: NOON })) === "ERR:not_a_pickup", "already handed over: not_a_pickup");
check(await say(await order({ slot: "NULL" })) === "ERR:not_booked_yet", "nothing booked: not_booked_yet");
check(await say(await order({ slot: "now() + interval '3 days'" })) === "ERR:not_pickup_day", "booked in 3 days: not_pickup_day");
check(await say(await order({ slot: "now() - interval '3 days'" })) === "ERR:not_pickup_day", "booked 3 days ago: not_pickup_day");
const porch = await order({ handover: "porch", slot: "now() + interval '3 days'", day: "(now() AT TIME ZONE 'America/Chicago')::date", titles: ["Porch lamp"] });
check(await say(porch) === "on_way", "a porch pickup day that is today: told");
check(await say(await order({ handover: "meetup", slot: NOON, titles: ["Spot rug"] })) === "on_way", "a meetup today: told");
const two = await order({ slot: NOON, titles: ["Alpha chair", "Beta chair"] });
check(await say(two) === "on_way", "two items: told");
check((await notices("%Alpha chair and 1 more%")).length === 1, "the notice names one and counts the rest");
const moved = await order({ slot: NOON, titles: ["Moved mug"] });
await db.query(`UPDATE public.declutter_bookings SET buyer_on_way_at = now() - interval '2 days' WHERE order_id = $1`, [moved]);
check(await say(moved) === "on_way", "said on an earlier day, pickup moved to today: told again");

if (!SKIP) {
  const acl = (await db.query(`SELECT proacl::text a FROM pg_proc WHERE proname = 'declutter_on_my_way'`)).rows[0].a ?? "";
  check(!/(^|[{,])anon=/.test(acl) && !/(^|[{,])=X/.test(acl) && /authenticated=X/.test(acl), `members only (${acl})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

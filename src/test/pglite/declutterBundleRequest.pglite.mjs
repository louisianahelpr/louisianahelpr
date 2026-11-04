#!/usr/bin/env node
/**
 * Q2268: a buyer asks one seller for several items in one request; the seller accepts all, picks some, or declines;
 * each accepted item becomes an in_cart line through declutter_take_item (an accepted offer's 24-hour hold), charged
 * least(asked price, today's price); an item sold meanwhile is 'unavailable' and never charged.
 *
 * Runs NEW_FILE VERBATIM (3x). declutter_lock_buyable_item is the REAL newest definition before NEW_FILE (any
 * dollar-quote tag), and so is declutter_identity_gate (review 11-04: the first-purchase ID check runs at the ask);
 * declutter_take_item, declutter_notify, the member checks and the gate's own inputs (is_identity_verified, ...) are
 * recording stubs (their own proofs live with them).
 *
 *   node src/test/pglite/declutterBundleRequest.pglite.mjs
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterBundleRequest.pglite.mjs   # RED on a planted defect
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_bundle_request.sql"));
if (!NEW_FILE) throw new Error("the Q2268 migration is missing");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? MIG_DIR + NEW_FILE, "utf8");

/** The newest definition of public.<name> in any migration sorting before `before` (any dollar-quote tag). */
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
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const SELLER = "99999999-0000-0000-0000-000000000000";
const BUYER = "99999999-0000-0000-0000-000000000001";
const OTHER_SELLER = "99999999-0000-0000-0000-000000000002";
const NOCARD = "99999999-0000-0000-0000-000000000003";
const NOID = "99999999-0000-0000-0000-000000000004";
const STRANGER = "99999999-0000-0000-0000-000000000005";
const item = (n) => `aaaaaaaa-0000-0000-0000-00000000000${n}`;

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users VALUES ('${SELLER}'), ('${BUYER}'), ('${OTHER_SELLER}'), ('${NOCARD}'), ('${NOID}'), ('${STRANGER}');
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE public.verified_ids (user_id uuid PRIMARY KEY);
INSERT INTO public.verified_ids VALUES ('${BUYER}'), ('${NOCARD}'), ('${SELLER}'), ('${STRANGER}');
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.has_role(uuid, text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.identity_check_exempt(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.is_identity_verified(p uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS (SELECT 1 FROM public.verified_ids v WHERE v.user_id = p) $$;
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid, current_price_cents integer, title text,
  status text, sale_mode text DEFAULT 'offers', is_seed boolean DEFAULT false, updated_at timestamptz);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid,
  seller_id uuid, price_cents integer, source text, offer_id uuid, checkout_by timestamptz);
CREATE TABLE public.declutter_buyer_cards (user_id uuid PRIMARY KEY);
INSERT INTO public.declutter_buyer_cards VALUES ('${BUYER}'), ('${NOID}');
CREATE TABLE public.notices (user_id uuid, title text, body text);
CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_seller_out(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.seed_hidden_for(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.member_under_18(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_notice_ref(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.declutter_assert_member(boolean) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF; RETURN auth.uid(); END $$;
CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_actor uuid)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices VALUES (p_user, p_title, p_body) $$;
-- Recording stub of the real hold path: reserves a live item and makes the line (55000 when it is not live).
CREATE FUNCTION public.declutter_take_item(p_item_id uuid, p_buyer uuid, p_price integer, p_source text, p_offer_id uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_seller uuid; v_line uuid;
BEGIN
  UPDATE public.declutter_items SET status = 'reserved' WHERE id = p_item_id AND status = 'live' RETURNING seller_id INTO v_seller;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_available' USING ERRCODE = '55000'; END IF;
  INSERT INTO public.declutter_cart_items (item_id, buyer_id, seller_id, price_cents, source, offer_id, checkout_by)
  VALUES (p_item_id, p_buyer, v_seller, p_price, p_source, p_offer_id, now() + interval '24 hours') RETURNING id INTO v_line;
  RETURN v_line;
END $$;
`);
await db.exec(definitionBefore("declutter_lock_buyable_item", NEW_FILE));
await db.exec(definitionBefore("declutter_identity_gate", NEW_FILE));
for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
check("the migration applies 3x (replay-safe)", true);

await db.exec(`
INSERT INTO public.declutter_items (id, seller_id, current_price_cents, title, status) VALUES
 ('${item(1)}', '${SELLER}', 1000, 'Lamp', 'live'), ('${item(2)}', '${SELLER}', 2000, 'Chair', 'live'),
 ('${item(3)}', '${SELLER}', 3000, 'Desk', 'live'), ('${item(4)}', '${OTHER_SELLER}', 500, 'Mug', 'live'),
 ('${item(5)}', '${SELLER}', 0, 'Free box', 'live'), ('${item(6)}', '${SELLER}', 1500, 'Rug', 'live');`);

const as = async (uid, sql, params = []) => {
  await db.exec(`SELECT set_config('test.uid', '${uid}', false)`);
  return db.query(sql, params);
};
const errOf = async (uid, sql, params = []) => {
  try { await as(uid, sql, params); return null; } catch (e) { return e.message; }
};
const arr = (...ids) => `{${ids.join(",")}}`;

// --- asking -----------------------------------------------------------------
check("one item is not a bundle", (await errOf(BUYER, "SELECT public.declutter_request_bundle($1)", [arr(item(1))])) === "bundle_size");
check("two sellers' items are refused", (await errOf(BUYER, "SELECT public.declutter_request_bundle($1)", [arr(item(1), item(4))])) === "bundle_one_seller");
check("a free item is refused", (await errOf(BUYER, "SELECT public.declutter_request_bundle($1)", [arr(item(1), item(5))])) === "bundle_free_item");
check("a buyer with no saved card is refused", (await errOf(NOCARD, "SELECT public.declutter_request_bundle($1)", [arr(item(1), item(2))])) === "card_required");
check("a buyer who has not passed the first-purchase ID check is refused at the ask (review 11-04)",
  (await errOf(NOID, "SELECT public.declutter_request_bundle($1)", [arr(item(1), item(2))])) === "identity_required_to_buy");
check("the seller cannot ask for their own items", (await errOf(SELLER, "SELECT public.declutter_request_bundle($1)", [arr(item(1), item(2))])) === "own_item");
const req = (await as(BUYER, "SELECT public.declutter_request_bundle($1) AS id", [arr(item(1), item(2), item(3))])).rows[0].id;
check("a 3-item request is made, 48 hours to answer",
  (await db.query(`SELECT respond_by > now() + interval '47 hours' AS ok FROM public.declutter_bundle_requests WHERE id = $1`, [req])).rows[0]?.ok === true);
check("the seller is told", (await db.query(`SELECT count(*)::int n FROM public.notices WHERE user_id = '${SELLER}' AND title = 'Bundle request'`)).rows[0].n === 1);
check("a second open request to the same seller is refused",
  (await errOf(BUYER, "SELECT public.declutter_request_bundle($1)", [arr(item(1), item(6))])) === "bundle_already_open");

// --- answering ----------------------------------------------------------------
check("only the request's seller may answer", (await errOf(BUYER, "SELECT public.declutter_answer_bundle($1, NULL)", [req])) === "bundle_not_found");
check("an item outside the request is refused",
  (await errOf(SELLER, "SELECT public.declutter_answer_bundle($1, $2)", [req, arr(item(6))])) === "bundle_item_not_in_request");
// The seller drops the Desk's price after the ask; meanwhile the Chair sells to someone else.
await db.exec(`UPDATE public.declutter_items SET current_price_cents = 2500 WHERE id = '${item(3)}';
               UPDATE public.declutter_items SET status = 'sold' WHERE id = '${item(2)}';`);
const n = (await as(SELLER, "SELECT public.declutter_answer_bundle($1, $2) AS n", [req, arr(item(2), item(3))])).rows[0].n;
check("Pick some: the picked item still on sale is accepted, the sold one is not", n === 1, `n=${n}`);
const lines = (await db.query(`SELECT item_id, price_cents, source, buyer_id FROM public.declutter_cart_items ORDER BY item_id`)).rows;
check("exactly one cart line, for the Desk, for the buyer", lines.length === 1 && lines[0].item_id === item(3) && lines[0].buyer_id === BUYER, JSON.stringify(lines));
check("charged the LOWER of the asked and today's price (2500, not 3000)", lines[0]?.price_cents === 2500, `${lines[0]?.price_cents}`);
check("the line is an accepted-offer hold (source offer, 24 h)", lines[0]?.source === "offer");
const outcomes = Object.fromEntries((await db.query(`SELECT item_id, outcome FROM public.declutter_bundle_request_items WHERE request_id = $1`, [req])).rows.map((r) => [r.item_id, r.outcome]));
check("outcomes: Lamp not picked, Chair unavailable, Desk accepted",
  outcomes[item(1)] === "not_picked" && outcomes[item(2)] === "unavailable" && outcomes[item(3)] === "accepted", JSON.stringify(outcomes));
check("the Lamp the seller did not pick stays on sale", (await db.query(`SELECT status FROM public.declutter_items WHERE id = '${item(1)}'`)).rows[0].status === "live");
check("the buyer is told to pay within 24 hours",
  (await db.query(`SELECT count(*)::int n FROM public.notices WHERE user_id = '${BUYER}' AND title LIKE 'Bundle accepted%'`)).rows[0].n === 1);
check("an answered request cannot be answered again", (await errOf(SELLER, "SELECT public.declutter_answer_bundle($1, NULL)", [req])) === "bundle_not_open");

// Accept all on a fresh request.
await db.exec(`UPDATE public.declutter_items SET status = 'live' WHERE id IN ('${item(1)}', '${item(6)}')`);
const req2 = (await as(BUYER, "SELECT public.declutter_request_bundle($1) AS id", [arr(item(1), item(6))])).rows[0].id;
const n2 = (await as(SELLER, "SELECT public.declutter_answer_bundle($1, NULL) AS n", [req2])).rows[0].n;
check("Accept all takes every item still on sale", n2 === 2, `n=${n2}`);

// Review 11-04: a buyer who removed their card meanwhile: nothing held, asked to save one, still open (-1).
await db.exec(`INSERT INTO public.declutter_items (id, seller_id, current_price_cents, title, status) VALUES
 ('${item(9)}', '${SELLER}', 900, 'Stool', 'live'), ('bbbbbbbb-0000-0000-0000-000000000001', '${SELLER}', 1200, 'Shelf', 'live'),
 ('bbbbbbbb-0000-0000-0000-000000000002', '${SELLER}', 1300, 'Bench', 'live');`);
const SHELF = "bbbbbbbb-0000-0000-0000-000000000001", BENCH = "bbbbbbbb-0000-0000-0000-000000000002";
const reqC = (await as(BUYER, "SELECT public.declutter_request_bundle($1) AS id", [arr(item(9), SHELF, BENCH)])).rows[0].id;
// The third member reads none of it (RLS), the buyer and the seller do.
const readAs = async (uid) => {
  await db.exec(`SELECT set_config('test.uid', '${uid}', false); SET ROLE authenticated;`);
  try {
    const a = (await db.query(`SELECT count(*)::int n FROM public.declutter_bundle_requests WHERE id = $1`, [reqC])).rows[0].n;
    const b = (await db.query(`SELECT count(*)::int n FROM public.declutter_bundle_request_items WHERE request_id = $1`, [reqC])).rows[0].n;
    return [a, b];
  } finally { await db.exec("RESET ROLE"); }
};
check("a third member reads neither the request nor its items", JSON.stringify(await readAs(STRANGER)) === "[0,0]");
check("the buyer and the seller read it", JSON.stringify(await readAs(BUYER)) === "[1,3]" && JSON.stringify(await readAs(SELLER)) === "[1,3]");
await db.exec(`DELETE FROM public.declutter_buyer_cards WHERE user_id = '${BUYER}'`);
const nC = (await as(SELLER, "SELECT public.declutter_answer_bundle($1, NULL) AS n", [reqC])).rows[0].n;
check("no card: -1, nothing held, the request stays open, the buyer is asked to save one",
  nC === -1 && (await db.query(`SELECT status FROM public.declutter_bundle_requests WHERE id = $1`, [reqC])).rows[0].status === "open"
  && (await db.query(`SELECT count(*)::int n FROM public.declutter_cart_items WHERE item_id IN ('${item(9)}', '${SHELF}', '${BENCH}')`)).rows[0].n === 0
  && (await db.query(`SELECT count(*)::int n FROM public.notices WHERE user_id = '${BUYER}' AND title = 'Save a card to get your bundle'`)).rows[0].n === 1, `n=${nC}`);
await db.exec(`INSERT INTO public.declutter_buyer_cards VALUES ('${BUYER}')`);
// The Shelf leaves offers mode and the Bench is made free meanwhile: each is 'unavailable', the Stool still goes.
await db.exec(`UPDATE public.declutter_items SET sale_mode = 'auction' WHERE id = '${SHELF}';
               UPDATE public.declutter_items SET current_price_cents = 0 WHERE id = '${BENCH}';`);
const nD = (await as(SELLER, "SELECT public.declutter_answer_bundle($1, NULL) AS n", [reqC])).rows[0].n;
const oD = Object.fromEntries((await db.query(`SELECT item_id, outcome FROM public.declutter_bundle_request_items WHERE request_id = $1`, [reqC])).rows.map((r) => [r.item_id, r.outcome]));
check("a sale-mode change and a price under $1 are 'unavailable', not a failed answer; the rest is accepted",
  nD === 1 && oD[item(9)] === "accepted" && oD[SHELF] === "unavailable" && oD[BENCH] === "unavailable", `n=${nD} ${JSON.stringify(oD)}`);
// This ask is not one of the 3-a-day the checks below count: made "yesterday".
await db.exec(`UPDATE public.declutter_bundle_requests SET created_at = now() - interval '25 hours' WHERE id = '${reqC}'`);

// Decline, withdraw, expire.
await db.exec(`INSERT INTO public.declutter_items (id, seller_id, current_price_cents, title, status) VALUES
 ('${item(7)}', '${SELLER}', 700, 'Vase', 'live'), ('${item(8)}', '${SELLER}', 800, 'Clock', 'live');`);
const req3 = (await as(BUYER, "SELECT public.declutter_request_bundle($1) AS id", [arr(item(7), item(8))])).rows[0].id;
const n3 = (await as(SELLER, "SELECT public.declutter_answer_bundle($1, '{}') AS n", [req3])).rows[0].n;
check("an empty pick declines: nothing held",
  n3 === 0 && (await db.query(`SELECT status FROM public.declutter_bundle_requests WHERE id = $1`, [req3])).rows[0].status === "declined"
  && (await db.query(`SELECT count(*)::int n FROM public.declutter_cart_items WHERE item_id IN ('${item(7)}', '${item(8)}')`)).rows[0].n === 0);
check("a 4th ask of one seller inside 24 hours is refused (3 a day)",
  (await errOf(BUYER, "SELECT public.declutter_request_bundle($1)", [arr(item(7), item(8))])) === "bundle_rate_limited");
await db.exec(`UPDATE public.declutter_bundle_requests SET created_at = now() - interval '25 hours'`);
const req4 = (await as(BUYER, "SELECT public.declutter_request_bundle($1) AS id", [arr(item(7), item(8))])).rows[0].id;
check("only the buyer may withdraw", (await errOf(SELLER, "SELECT public.declutter_withdraw_bundle($1)", [req4])) === "bundle_not_found");
await as(BUYER, "SELECT public.declutter_withdraw_bundle($1)", [req4]);
check("the buyer withdraws an open request", (await db.query(`SELECT status FROM public.declutter_bundle_requests WHERE id = $1`, [req4])).rows[0].status === "withdrawn");
const req5 = (await as(BUYER, "SELECT public.declutter_request_bundle($1) AS id", [arr(item(7), item(8))])).rows[0].id;
await db.exec(`UPDATE public.declutter_bundle_requests SET respond_by = now() - interval '1 minute' WHERE id = '${req5}'`);
check("a request past 48 hours cannot be accepted", (await errOf(SELLER, "SELECT public.declutter_answer_bundle($1, NULL)", [req5])) === "bundle_not_open");
const swept = (await db.query(`SELECT public.declutter_bundle_sweep() AS n`)).rows[0].n;
// An unswept expired request never blocks a new ask (closed inline).
const req6 = (await as(BUYER, "SELECT public.declutter_request_bundle($1) AS id", [arr(item(7), item(8))])).rows[0].id;
await db.exec(`UPDATE public.declutter_bundle_requests SET respond_by = now() - interval '1 minute', created_at = now() - interval '25 hours' WHERE id = '${req6}'`);
const req7 = (await as(BUYER, "SELECT public.declutter_request_bundle($1) AS id", [arr(item(7), item(8))])).rows[0].id;
check("an expired, unswept request is closed by the next ask instead of blocking it",
  (await db.query(`SELECT status FROM public.declutter_bundle_requests WHERE id = $1`, [req6])).rows[0].status === "expired" && Boolean(req7));
check("the sweep expires it and tells the buyer", swept === 1
  && (await db.query(`SELECT status FROM public.declutter_bundle_requests WHERE id = $1`, [req5])).rows[0].status === "expired");

// --- grants -------------------------------------------------------------------
const acl = (await db.query(`SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x FROM pg_proc p
  WHERE p.proname IN ('declutter_request_bundle', 'declutter_answer_bundle', 'declutter_withdraw_bundle', 'declutter_bundle_sweep')`)).rows;
check("anon executes none of the four", acl.length === 4 && acl.every((r) => !r.anon_x), JSON.stringify(acl));
check("members execute ask/answer/withdraw, never the sweep",
  acl.filter((r) => r.auth_x).map((r) => r.proname).sort().join() === "declutter_answer_bundle,declutter_request_bundle,declutter_withdraw_bundle");
check("members cannot write the tables directly",
  (await db.query(`SELECT has_table_privilege('authenticated', 'public.declutter_bundle_requests', 'INSERT') i,
                          has_table_privilege('authenticated', 'public.declutter_bundle_request_items', 'UPDATE') u`)).rows.every((r) => !r.i && !r.u));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);

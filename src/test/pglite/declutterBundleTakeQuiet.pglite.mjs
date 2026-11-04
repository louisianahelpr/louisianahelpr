#!/usr/bin/env node
/**
 * Q2731 (from the Q2268 money review): an accepted bundle leaves exactly ONE notice per side, and the buyer is asked to
 * save a card at most once per request. Runs the REAL declutter_take_item and declutter_answer_bundle of
 * 20261104124645_declutter_bundle_take_quiet.sql (3x) on top of 20261104103528 (the bundle tables and RPCs):
 *   - an accepted 3-item bundle: the buyer gets "Bundle accepted", the seller "Bundle sold", and no per-item
 *     "Reserved for you" / "Sold: waiting" notice; another buyer's open offer on one of the items is still told
 *     "Item on hold for another buyer";
 *   - after the answer, an ordinary take (Buy now) still sends its per-item notices (the setting is transaction-local
 *     and turned off);
 *   - a seller tapping Accept twice while the buyer has no card: one "Save a card" notice, card_asked_at stamped;
 *   - take_item's body is 20261103222939's verbatim apart from the wrapping IF (re-indented).
 *
 *   node src/test/pglite/declutterBundleTakeQuiet.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterBundleTakeQuiet.pglite.mjs  # RED: 20261104103528 + the old take_item
 *   MIGRATION_PATH=<planted copy> node ...                                      # RED on a planted defect
 *
 * declutter_notify, the member checks and the money helpers' inputs are recording stubs; declutter_lock_buyable_item and
 * declutter_identity_gate are the real newest definitions. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BUNDLE = "20261104103528_declutter_bundle_request.sql";
const OLD_TAKE = "20261103222939_q2390_helpr_answer_take_item_report_problem_answer_no_show_fault_report_copy_not_found_is_404.sql";
const NEW_FILE = "20261104124645_declutter_bundle_take_quiet.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

/** The newest definition of public.<name> in any migration sorting before `before` (any dollar-quote tag). */
function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    for (const m of sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      last = rest.slice(0, rest.indexOf(tag[1], tag.index + tag[0].length) + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}
/** The one definition of public.<name> in one file. */
function definitionIn(file, name) {
  const sql = readFileSync(MIG_DIR + file, "utf8");
  const m = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "i").exec(sql);
  if (!m) throw new Error(`${file}: no ${name}`);
  const rest = sql.slice(m.index);
  const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
  return rest.slice(0, rest.indexOf(tag[1], tag.index + tag[0].length) + tag[1].length) + ";";
}

let failures = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`);
  if (ok) passes++;
  else failures++;
};

// 0. Verbatim: the new take_item minus its wrapping IF (and one level of indent inside it) is the old one.
{
  const oldDef = definitionIn(OLD_TAKE, "declutter_take_item");
  const newDef = definitionIn(skip ? OLD_TAKE : NEW_FILE, "declutter_take_item");
  const open = newDef.indexOf("  -- Q2731 (Q2268 money review 11-04)");
  const ifLine = "  IF coalesce(current_setting('declutter.bundle_take', true), '') <> 'on' THEN\n";
  const close = "  END IF;\n  END IF;\n  RETURN v_line;";
  let unwrapped = null;
  if (open > 0 && newDef.includes(ifLine) && newDef.includes(close)) {
    const start = newDef.indexOf(ifLine) + ifLine.length;
    const end = newDef.indexOf(close) + "  END IF;\n".length;
    const inner = newDef.slice(start, end).split("\n").map((l) => (l.startsWith("  ") ? l.slice(2) : l)).join("\n");
    unwrapped = newDef.slice(0, open) + inner + newDef.slice(end + "  END IF;\n".length);
  }
  check("take_item is 20261103222939's body verbatim apart from the wrapping bundle-take IF", unwrapped === oldDef, skip ? "skip" : "");
}

const SELLER = "99999999-0000-0000-0000-000000000000";
const BUYER = "99999999-0000-0000-0000-000000000001";
const RIVAL = "99999999-0000-0000-0000-000000000002";
const NOCARD = "99999999-0000-0000-0000-000000000003";
const item = (n) => `aaaaaaaa-0000-0000-0000-00000000000${n}`;

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users VALUES ('${SELLER}'), ('${BUYER}'), ('${RIVAL}'), ('${NOCARD}');
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.has_role(uuid, text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.identity_check_exempt(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.is_identity_verified(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid, current_price_cents integer, title text,
  status text, sale_mode text DEFAULT 'offers', is_seed boolean DEFAULT false, updated_at timestamptz);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid,
  seller_id uuid, price_cents integer, source text, offer_id uuid, checkout_by timestamptz);
CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, status text,
  closed_at timestamptz, updated_at timestamptz, voided_by_line uuid);
CREATE TABLE public.declutter_offer_events (offer_id uuid, actor_side text, action text);
CREATE TABLE public.declutter_buyer_cards (user_id uuid PRIMARY KEY);
INSERT INTO public.declutter_buyer_cards VALUES ('${BUYER}');
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text);
CREATE TABLE public.notices (user_id uuid, title text, body text);
CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_seller_out(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.seed_hidden_for(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.member_under_18(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.member_display_name(text, text) RETURNS text LANGUAGE sql AS $$ SELECT coalesce($1, $2) $$;
CREATE FUNCTION public.declutter_price_text(integer) RETURNS text LANGUAGE sql AS $$ SELECT '$' || ($1 / 100)::text $$;
CREATE FUNCTION public.declutter_hold_length(integer, text) RETURNS interval LANGUAGE sql AS $$ SELECT interval '24 hours' $$;
CREATE FUNCTION public.declutter_notice_ref(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.declutter_assert_member(boolean) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF; RETURN auth.uid(); END $$;
CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_actor uuid)
RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices VALUES (p_user, p_title, p_body) $$;
`);
await db.exec(definitionBefore("declutter_lock_buyable_item", BUNDLE));
await db.exec(definitionBefore("declutter_identity_gate", BUNDLE));
await db.exec(definitionIn(OLD_TAKE, "declutter_take_item"));
await db.exec(readFileSync(MIG_DIR + BUNDLE, "utf8"));
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("the migration applies 3x (replay-safe)", true);
}

await db.exec(`
INSERT INTO public.declutter_items (id, seller_id, current_price_cents, title, status) VALUES
 ('${item(1)}', '${SELLER}', 1000, 'Lamp', 'live'), ('${item(2)}', '${SELLER}', 2000, 'Chair', 'live'),
 ('${item(3)}', '${SELLER}', 3000, 'Desk', 'live'), ('${item(4)}', '${SELLER}', 900, 'Stool', 'live'),
 ('${item(5)}', '${SELLER}', 1100, 'Shelf', 'live'), ('${item(6)}', '${SELLER}', 1200, 'Mirror', 'live');
INSERT INTO public.declutter_offers (item_id, buyer_id, status) VALUES ('${item(2)}', '${RIVAL}', 'open');`);
const as = async (uid, sql, params = []) => {
  await db.exec(`SELECT set_config('test.uid', '${uid}', false)`);
  return db.query(sql, params);
};
const arr = (...ids) => `{${ids.join(",")}}`;
const titles = async (uid) => (await db.query(`SELECT title FROM public.notices WHERE user_id = $1 ORDER BY title`, [uid])).rows.map((r) => r.title);

// 1. An accepted 3-item bundle.
const req = (await as(BUYER, "SELECT public.declutter_request_bundle($1) AS id", [arr(item(1), item(2), item(3))])).rows[0].id;
await db.exec("DELETE FROM public.notices");
const n = (await as(SELLER, "SELECT public.declutter_answer_bundle($1, NULL) AS n", [req])).rows[0].n;
check("Accept all takes the 3 items", n === 3, `n=${n}`);
const b = await titles(BUYER);
const s = await titles(SELLER);
check("the buyer gets exactly one notice for the bundle", JSON.stringify(b) === JSON.stringify(["Bundle accepted: pay within 24 hours"]), JSON.stringify(b));
check("the seller gets exactly one notice for the bundle", JSON.stringify(s) === JSON.stringify(["Bundle sold: waiting for the buyer to pay"]), JSON.stringify(s));
check("another buyer's open offer on one of the items is still told it is on hold", JSON.stringify(await titles(RIVAL)) === JSON.stringify(["Item on hold for another buyer"]), JSON.stringify(await titles(RIVAL)));
check("the setting is off again after the answer", (await db.query(`SELECT coalesce(current_setting('declutter.bundle_take', true), '') AS v`)).rows[0].v !== "on");

// 2. An ordinary take still sends its per-item notices.
await db.exec("DELETE FROM public.notices");
await db.query(`SELECT public.declutter_take_item($1, $2, 900, 'buy', NULL)`, [item(4), BUYER]);
check("a Buy now take after it still tells the buyer and the seller", JSON.stringify(await titles(BUYER)) === JSON.stringify(["Reserved for you: check out within 30 minutes"])
  && JSON.stringify(await titles(SELLER)) === JSON.stringify(["Sold: waiting for the buyer to pay"]), JSON.stringify([await titles(BUYER), await titles(SELLER)]));

// 2b. In the SAME transaction as an answer (one multi-statement query = one implicit transaction), a later take still
// sends its notices: the answer turned the setting off again after its loop.
await db.exec(`INSERT INTO public.declutter_items (id, seller_id, current_price_cents, title, status) VALUES
 ('${item(7)}', '${SELLER}', 700, 'Vase', 'live'), ('${item(8)}', '${SELLER}', 800, 'Clock', 'live'),
 ('${item(9)}', '${SELLER}', 950, 'Fan', 'live');`);
const reqT = (await as(BUYER, "SELECT public.declutter_request_bundle($1) AS id", [arr(item(7), item(8))])).rows[0].id;
await db.exec("DELETE FROM public.notices");
await db.exec(`SELECT set_config('test.uid', '${SELLER}', false);
  SELECT public.declutter_answer_bundle('${reqT}', NULL);
  SELECT public.declutter_take_item('${item(9)}', '${BUYER}', 950, 'buy', NULL);`);
check("same transaction: the take after an answer still sends its per-item notices",
  (await titles(BUYER)).includes("Reserved for you: check out within 30 minutes") && (await titles(SELLER)).includes("Sold: waiting for the buyer to pay"),
  JSON.stringify([await titles(BUYER), await titles(SELLER)]));

// 3. No card: one "Save a card" ask per request, however often the seller taps.
await db.exec(`INSERT INTO public.declutter_buyer_cards VALUES ('${NOCARD}')`);
const reqC = (await as(NOCARD, "SELECT public.declutter_request_bundle($1) AS id", [arr(item(5), item(6))])).rows[0].id;
await db.exec(`DELETE FROM public.declutter_buyer_cards WHERE user_id = '${NOCARD}'; DELETE FROM public.notices;`);
const t1 = (await as(SELLER, "SELECT public.declutter_answer_bundle($1, NULL) AS n", [reqC])).rows[0].n;
const t2 = (await as(SELLER, "SELECT public.declutter_answer_bundle($1, NULL) AS n", [reqC])).rows[0].n;
const asks = (await db.query(`SELECT count(*)::int n FROM public.notices WHERE user_id = '${NOCARD}' AND title = 'Save a card to get your bundle'`)).rows[0].n;
check("two no-card answers: -1 each, ONE 'Save a card' notice", t1 === -1 && t2 === -1 && asks === 1, `t1=${t1} t2=${t2} asks=${asks}`);
const stamped = await db.query(`SELECT card_asked_at IS NOT NULL AS ok, status FROM public.declutter_bundle_requests WHERE id = $1`, [reqC]).catch((e) => ({ rows: [{ ok: false, status: e.message }] }));
check("card_asked_at is stamped and the request stays open", stamped.rows[0]?.ok === true && stamped.rows[0]?.status === "open", JSON.stringify(stamped.rows[0]));
await db.exec(`INSERT INTO public.declutter_buyer_cards VALUES ('${NOCARD}')`);
const t3 = (await as(SELLER, "SELECT public.declutter_answer_bundle($1, NULL) AS n", [reqC])).rows[0].n;
check("once a card is saved the answer goes through", t3 === 2, `t3=${t3}`);

// 4. Grants unchanged.
const acl = (await db.query(`SELECT has_function_privilege('authenticated', 'public.declutter_take_item(uuid, uuid, integer, text, uuid)', 'EXECUTE') t,
  has_function_privilege('anon', 'public.declutter_answer_bundle(uuid, uuid[])', 'EXECUTE') a,
  has_function_privilege('authenticated', 'public.declutter_answer_bundle(uuid, uuid[])', 'EXECUTE') m`)).rows[0];
check("take_item is not a member call; answer_bundle is a member call, never anon's", !acl.t && !acl.a && acl.m, JSON.stringify(acl));

console.log(failures ? `\n${failures} FAILED, ${passes} passed` : `\nALL ${passes} PASS`);
process.exit(failures ? 1 : 0);

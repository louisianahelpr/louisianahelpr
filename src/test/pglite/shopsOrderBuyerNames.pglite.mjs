#!/usr/bin/env node
/**
 * PGlite proof for 20261106170629_shops_order_buyer_names.sql (Q2104): the shop dashboard reads its own orders' buyer
 * first names, and nothing else.
 *
 *   node src/test/pglite/shopsOrderBuyerNames.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsOrderBuyerNames.pglite.mjs # red: the checks need it
 *   MIGRATION_PATH=<planted copy> node ...                                  # red on a planted defect
 *
 * World: cut-down prod-shaped tables (auth.users, profiles, user_blocks, shop_orders). are_users_blocked is the real
 * newest body (20260926034721, a party-only check) over an is_server_context stub (false). Supabase's DEFAULT
 * PRIVILEGES (EXECUTE on new functions to anon, authenticated, service_role) are emulated, so the REVOKE is proved.
 * Stubs: require_feature (no-op), is_caller_banned (a banned-ids table).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SQL = readFileSync(process.env.MIGRATION_PATH ?? `${DIR}20261106170629_shops_order_buyer_names.sql`, "utf8");
const BLOCKED_SQL = readFileSync(`${DIR}20260926034721_are_users_blocked_party_only.sql`, "utf8");
const blockedFn = /CREATE OR REPLACE FUNCTION public\.are_users_blocked[\s\S]*?\$function\$;/.exec(BLOCKED_SQL)?.[0];
if (!blockedFn) throw new Error("setup: are_users_blocked body not found");

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), OWNER2 = U(2), ANA = U(3), BOB = U(4), NONAME = U(5), BLOCKER = U(6), STRANGER = U(7), BANNED = U(8);
const SHOP = U(10), SHOP2 = U(11);
const O_ANA = U(20), O_BOB = U(21), O_NONAME = U(22), O_BLOCKED = U(23), O_GONE = U(24), O_OTHER = U(25);

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE TABLE public.banned (user_id uuid PRIMARY KEY);
  CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT EXISTS (SELECT 1 FROM public.banned WHERE user_id = auth.uid()) $$;
  CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text);
  CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
  CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, shop_id uuid, buyer_id uuid, seller_id uuid, status text);
  ${blockedFn}
  INSERT INTO auth.users VALUES ('${OWNER}'), ('${OWNER2}'), ('${ANA}'), ('${BOB}'), ('${NONAME}'), ('${BLOCKER}'), ('${STRANGER}'), ('${BANNED}');
  INSERT INTO public.banned VALUES ('${BANNED}');
  INSERT INTO public.profiles VALUES ('${OWNER}', 'Ruth Landry'), ('${ANA}', '  Ana Marie Broussard '), ('${BOB}', 'Bob'),
    ('${NONAME}', '   '), ('${BLOCKER}', 'Cal Guidry'), ('${STRANGER}', 'Dee Hebert');
  INSERT INTO public.user_blocks VALUES ('${BLOCKER}', '${OWNER}');
  INSERT INTO public.shop_orders VALUES
    ('${O_ANA}', '${SHOP}', '${ANA}', '${OWNER}', 'held'),
    ('${O_BOB}', '${SHOP}', '${BOB}', '${OWNER}', 'accepted'),
    ('${O_NONAME}', '${SHOP}', '${NONAME}', '${OWNER}', 'handed_over'),
    ('${O_BLOCKED}', '${SHOP}', '${BLOCKER}', '${OWNER}', 'held'),
    ('${O_GONE}', '${SHOP}', NULL, '${OWNER}', 'refunded'),
    ('${O_OTHER}', '${SHOP2}', '${ANA}', '${OWNER2}', 'held');
`);
if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(SQL);

let failed = 0;
const ok = (name, cond, detail = "") => { if (cond) console.log(`OK   ${name}`); else { failed++; console.log(`FAIL ${name} ${detail}`); } };
const as = async (uid, sql, params = []) => {
  await db.exec(`SELECT set_config('test.uid', '${uid ?? ""}', false)`);
  try { return { rows: (await db.query(sql, params)).rows, err: null }; } catch (e) { return { rows: [], err: e.message }; }
  finally { await db.exec(`SELECT set_config('test.uid', '', false)`); }
};
const ALL = [O_ANA, O_BOB, O_NONAME, O_BLOCKED, O_GONE, O_OTHER];
const names = async (uid, ids = ALL) => {
  const r = await as(uid, `SELECT order_id, first_name FROM public.shops_my_order_buyer_names($1::uuid[])`, [ids]);
  return { map: Object.fromEntries(r.rows.map((x) => [x.order_id, x.first_name])), n: r.rows.length, err: r.err };
};

const own = await names(OWNER);
ok("the shop gets its own order's buyer's first name only", own.map[O_ANA] === "Ana" && own.map[O_BOB] === "Bob", JSON.stringify(own));
ok("never a full name", own.n > 0 && !Object.values(own.map).some((v) => v !== "A shopper" && / /.test(v)), JSON.stringify(own.map));
ok("a buyer with no name reads 'A shopper'", own.map[O_NONAME] === "A shopper", JSON.stringify(own.map));
ok("nothing for a pair that blocked each other", own.n > 0 && !(O_BLOCKED in own.map), JSON.stringify(own.map));
ok("nothing for a buyer who deleted their account", own.n > 0 && !(O_GONE in own.map), JSON.stringify(own.map));
ok("nothing for another shop's order, even with the same buyer", own.n > 0 && !(O_OTHER in own.map), JSON.stringify(own.map));
ok("exactly those three", own.n === 3 && !own.err, JSON.stringify(own));

const other = await names(OWNER2);
ok("the other shop gets only its own order", other.n === 1 && other.map[O_OTHER] === "Ana", JSON.stringify(other));
const buyer = await names(ANA);
ok("a buyer reading the list gets nothing (not a shop's reader)", buyer.n === 0 && !buyer.err, JSON.stringify(buyer));
const stranger = await names(STRANGER);
ok("a stranger gets nothing", stranger.n === 0 && !stranger.err, JSON.stringify(stranger));
const anon = await names(null);
ok("signed out is refused", /not_authenticated/.test(anon.err ?? ""), JSON.stringify(anon));
const banned = await names(BANNED);
ok("a banned account is refused", /account_restricted/.test(banned.err ?? ""), JSON.stringify(banned));
const empty = await names(OWNER, []);
ok("an empty list answers empty", empty.n === 0 && !empty.err, JSON.stringify(empty));
const many = await names(OWNER, Array.from({ length: 101 }, (_, i) => U(i % 100)));
ok("more than 100 ids are refused", /too_many_orders/.test(many.err ?? ""), JSON.stringify(many));

const g = (await db.query(`SELECT has_function_privilege('anon', 'public.shops_my_order_buyer_names(uuid[])', 'EXECUTE') AS a,
  has_function_privilege('authenticated', 'public.shops_my_order_buyer_names(uuid[])', 'EXECUTE') AS m`).catch(() => ({ rows: [{}] }))).rows[0];
ok("anon cannot run it; members can", g.a === false && g.m === true, JSON.stringify(g));

const total = 15;
console.log(`\n${total - failed} PASS, ${failed} FAIL${process.env.NEW_MIGRATION === "skip" ? " (NEW_MIGRATION=skip)" : ""}`);
process.exit(failed ? 1 : 0);

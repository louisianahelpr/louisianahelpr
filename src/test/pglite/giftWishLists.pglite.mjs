#!/usr/bin/env node
/**
 * PGlite proof for 20261120062130_gift_wish_lists (owner 2026-11-20): the gift guides' wish list share and sync.
 * A guest's share saves a snapshot and returns a 10-character code; anyone reads it back by code (name + refs only);
 * a signed-in account keeps ONE row whose code never changes; bad refs, too many items, an empty guest list and a long
 * name are refused; the rate limit stops the 11th guest save from one address in 10 minutes (but not another
 * address's); a test account's row is is_seed; nobody but the owner reads gift_wish_list_mine; anon and authenticated
 * hold no table privilege.
 *
 *   node src/test/pglite/giftWishLists.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/giftWishLists.pglite.mjs # RED
 *   MUTANT=<name> node ...                                           # each must FAIL (see MUTANTS)
 *
 * World: auth.users, auth.uid() read from the test.uid setting, and is_test_member stubbed as a test_accounts list
 * (its own proof: the 20261030015205 migration's). attach_unconfirmed_email_gate is absent here (the migration skips it).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_gift_wish_lists.sql"));
if (!THIS) throw new Error("migration not found");

const MUTANTS = {
  noRateLimit: ["  v_limit := CASE WHEN v_uid IS NULL THEN 10 ELSE 60 END;", "  v_limit := 1000000;"],
  noRefCheck: ["        OR NOT COALESCE((e->>'i') ~ '^[a-z0-9]{1,16}$', false)\n", ""],
  noKeyCount: ["        OR (SELECT count(*) FROM jsonb_object_keys(e)) <> 2\n", ""],
  noCap: ["OR jsonb_array_length(p_items) > 100 THEN", "THEN"],
  emptyGuestOk: ["  IF v_uid IS NULL AND jsonb_array_length(v_items) = 0 THEN", "  IF false THEN"],
  newRowEachSave: ["        ON CONFLICT (user_id) DO UPDATE\n          SET name = EXCLUDED.name, items = EXCLUDED.items, is_seed = EXCLUDED.is_seed, updated_at = now()\n", "        ON CONFLICT (code) DO NOTHING\n"],
  seedNotMarked: ["VALUES (v_code, v_name, v_items, v_uid, public.is_test_member(v_uid))", "VALUES (v_code, v_name, v_items, v_uid, false)"],
  mineForAll: ["   WHERE w.user_id = (SELECT auth.uid())\n     AND (SELECT auth.uid()) IS NOT NULL\n", "   WHERE true\n"],
  anonTable: ["REVOKE ALL ON TABLE public.gift_wish_lists FROM PUBLIC, anon, authenticated;", "GRANT SELECT ON TABLE public.gift_wish_lists TO anon;"],
  noDedupe: ["      SELECT DISTINCT ON (e->>'i') e->>'g' AS g, e->>'i' AS i, n", "      SELECT DISTINCT ON (e->>'i', n) e->>'g' AS g, e->>'i' AS i, n"],
  firstAddrBucket: ["v_addr := nullif(btrim(reverse(split_part(reverse(COALESCE(v_headers->>'x-forwarded-for', '')), ',', 1))), '');", "v_addr := 'same';"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
const MUTANT = process.env.MUTANT ?? "";
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || mig.split(m[0]).length !== 2) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const ANN = "11111111-0000-0000-0000-000000000001";
const TEST = "11111111-0000-0000-0000-000000000002";
const BEN = "11111111-0000-0000-0000-000000000003";

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  INSERT INTO auth.users VALUES ('${ANN}'), ('${TEST}'), ('${BEN}');
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  INSERT INTO public.test_accounts VALUES ('${TEST}');
  CREATE FUNCTION public.is_test_member(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p) $f$;
`);
if (process.env.NEW_MIGRATION !== "skip") for (let k = 0; k < 3; k++) await db.exec(mig);

const as = async (uid, addr) => {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid ?? ""]);
  await db.query(`SELECT set_config('request.headers', $1, false)`, [JSON.stringify({ "x-forwarded-for": `9.9.9.9, ${addr ?? "1.1.1.1"}` })]);
};
const save = async (name, items) => {
  try {
    const r = await db.query(`SELECT public.gift_wish_list_save($1, $2::jsonb) AS c`, [name, JSON.stringify(items)]);
    return { code: r.rows[0].c };
  } catch (e) {
    return { err: String(e.message) };
  }
};
const get = async (code) => {
  try { return (await db.query(`SELECT public.gift_wish_list_get($1) AS l`, [code])).rows[0].l; } catch (e) { return { err: String(e.message) }; }
};
const A = { g: "her", i: "abc123" };
const B = { g: "black-friday-cyber-monday", i: "z9" };

// A guest shares.
await as(null, "2.2.2.2");
const s1 = await save("Lexi's Christmas List", [A, B, A]);
check(/^[a-z0-9]{10}$/.test(s1.code ?? ""), `guest share returns a 10-char code (${JSON.stringify(s1)})`);
const l1 = await get(s1.code ?? "none");
check(l1?.name === "Lexi's Christmas List", "the list reads back by code with its name");
check(JSON.stringify(l1?.items) === JSON.stringify([A, B]), `items read back as refs, each once, in order (${JSON.stringify(l1?.items)})`);
check(l1 && Object.keys(l1).sort().join(",") === "items,name,updated_at", "the read carries name, items and updated_at only");
check((await get("nonexistnt")) === null, "an unknown code reads null");
const s2 = await save("", [A]);
check((await get(s2.code ?? ""))?.name === "My Wish List", "an empty name saves as My Wish List");

// Refusals.
check(/invalid_items/.test((await save("x", [{ g: "her", i: "BAD!" }])).err ?? ""), "a bad item id is refused");
check(/invalid_items/.test((await save("x", [{ g: "her", i: "a1", email: "x@y.z" }])).err ?? ""), "an extra key in a ref is refused");
check(/invalid_items/.test((await save("x", Array.from({ length: 101 }, (_, n) => ({ g: "her", i: `a${n}` })))).err ?? ""), "101 items are refused");
check(/empty_list/.test((await save("x", [])).err ?? ""), "an empty guest share is refused");
check(/invalid_name/.test((await save("x".repeat(61), [A])).err ?? ""), "a 61-character name is refused");

// Rate limit: 2 good saves from 2.2.2.2 so far (refusals before the limit are not counted); 8 more pass, the 11th fails.
let last;
for (let n = 0; n < 8; n++) last = await save("x", [A]);
check(!!last.code, "the 10th guest save from one address passes");
check(/rate_limited/.test((await save("x", [A])).err ?? ""), "the 11th guest save from one address in 10 minutes is refused");
await as(null, "3.3.3.3");
check(!!(await save("x", [A])).code, "another address still saves");

// Signed in: one row, the same code every save.
await as(ANN, "4.4.4.4");
const m1 = await save("Ann's list", [A]);
const m2 = await save("Ann's list 2", [A, B]);
check(!!m1.code && m1.code === m2.code, `an account's saves keep one code (${m1.code} / ${m2.code})`);
check((await get(m1.code ?? ""))?.name === "Ann's list 2", "the shared link follows the account's latest save");
check(!!(await save("Ann", [])).code, "an account may sync an empty list");
const mine = (await db.query(`SELECT public.gift_wish_list_mine() AS m`)).rows[0].m;
check(mine?.code === m1.code && Array.isArray(mine.items), "gift_wish_list_mine returns the account's own list");
await as(BEN, "5.5.5.5");
check((await db.query(`SELECT public.gift_wish_list_mine() AS m`)).rows[0].m === null, "another account's mine is null (never Ann's)");
await as(null, "5.5.5.5");
check((await db.query(`SELECT public.gift_wish_list_mine() AS m`)).rows[0].m === null, "a guest's mine is null");
const rows = (await db.query(`SELECT count(*)::int AS n FROM public.gift_wish_lists WHERE user_id = '${ANN}'`)).rows[0].n;
check(rows === 1, `one row per account (${rows})`);

// Test isolation.
await as(TEST, "6.6.6.6");
await save("t", [A]);
const seed = (await db.query(`SELECT is_seed FROM public.gift_wish_lists WHERE user_id = '${TEST}'`)).rows[0]?.is_seed;
check(seed === true, "a test account's list is is_seed");
const annSeed = (await db.query(`SELECT is_seed FROM public.gift_wish_lists WHERE user_id = '${ANN}'`)).rows[0]?.is_seed;
check(annSeed === false, "a real account's list is not is_seed");

// Privileges.
const priv = (await db.query(`SELECT has_table_privilege('anon', 'public.gift_wish_lists', 'SELECT') AS a, has_table_privilege('authenticated', 'public.gift_wish_lists', 'INSERT') AS b, has_table_privilege('anon', 'public.gift_wish_list_hits', 'SELECT') AS c`)).rows[0];
check(!priv.a && !priv.b && !priv.c, "anon/authenticated hold no table privilege");
const fx = (await db.query(`SELECT has_function_privilege('anon', 'public.gift_wish_list_mine()', 'EXECUTE') AS m, has_function_privilege('anon', 'public.gift_wish_list_get(text)', 'EXECUTE') AS g`)).rows[0];
check(!fx.m && fx.g, "anon may read by code but not call mine");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/**
 * PGlite proof for 20261121204723_gift_wish_lists_share (owner 2026-11-21: "they should also be able to share all
 * lists"): gift_wish_lists_share saves several named lists as ONE snapshot (user_id NULL, signed in or not) and returns
 * a 12-character code; gift_wish_list_get reads them back under 'lists' (names + refs only); a link made before reads
 * exactly as before (no 'lists' key). Bad refs, extra keys, 51 lists, 101 refs in a list, a link or phone number as a
 * list name and nothing to share are refused; lists with no gift are left out; the rate limit is gift_wish_list_save's
 * own (one budget); a test browser's share is is_seed; an account's own wish list row is never touched; the daily
 * prune removes old shares; anon and authenticated still hold no table privilege.
 *
 *   node src/test/pglite/giftWishListsShare.pglite.mjs                    # ALL PASS (new migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/giftWishListsShare.pglite.mjs # RED
 *   MUTANT=<name> node ...                                                # each must FAIL (see MUTANTS)
 *
 * World: auth.users, auth.uid() from the test.uid setting, is_test_member stubbed as a test_accounts list, and the base
 * migration 20261120062130_gift_wish_lists applied once before this one.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const files = readdirSync(MIG_DIR);
const BASE = files.find((f) => f.endsWith("_gift_wish_lists.sql"));
const THIS = files.find((f) => f.endsWith("_gift_wish_lists_share.sql"));
if (!BASE || !THIS) throw new Error("migration not found");

const MUTANTS = {
  noRefCheck: ["          OR NOT COALESCE((e->>'i') ~ '^[a-z0-9]{1,16}$', false)\n", ""],
  noListKeyCount: ["       OR (SELECT count(*) FROM jsonb_object_keys(v_list)) <> 2\n", ""],
  noListCap: ["jsonb_array_length(p_lists) NOT BETWEEN 1 AND 50 THEN", "jsonb_array_length(p_lists) < 1 THEN"],
  noItemCap: ["       OR jsonb_array_length(v_list->'items') > 100 THEN", "       THEN"],
  urlNameOk: ["       OR v_name ~* '(https?:|www\\.|\\.[a-z]{2,}/|\\m[a-z0-9-]+\\.[a-z]{2,}\\M)'\n", ""],
  phoneNameOk: ["       OR regexp_replace(v_name, '[\\s().+-]', '', 'g') ~ '[0-9]{7,}' THEN", "       THEN"],
  keepEmptyLists: ["    IF jsonb_array_length(v_items) > 0 THEN\n      v_out", "    IF true THEN\n      v_out"],
  noRateLimit: ["  v_limit := 10;", "  v_limit := 1000000;"],
  noTotalCap: ["    IF v_total > 300 THEN", "    IF false THEN"],
  ownRowForAccount: ["      VALUES (v_code, 'Gift lists', '[]'::jsonb, v_out, NULL, v_seed);", "      VALUES (v_code, 'Gift lists', '[]'::jsonb, v_out, v_uid, v_seed);"],
  seedIgnored: ["  v_seed := COALESCE(p_test, false)\n            OR", "  v_seed :="],
  getDropsLists: ["         || CASE WHEN w.lists IS NOT NULL THEN jsonb_build_object('lists', w.lists) ELSE '{}'::jsonb END\n", ""],
  getAlwaysLists: ["CASE WHEN w.lists IS NOT NULL THEN jsonb_build_object('lists', w.lists) ELSE '{}'::jsonb END", "jsonb_build_object('lists', w.lists)"],
  anonExec: ["REVOKE ALL ON FUNCTION public.gift_wish_lists_share(jsonb, boolean) FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public.gift_wish_lists_share(jsonb, boolean) TO anon, authenticated, service_role;", "GRANT ALL ON TABLE public.gift_wish_lists TO anon;"],
  noStrip: ["v_name := btrim(regexp_replace(v_list->>'n', '[[:cntrl:]\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2069\\ufeff]', '', 'g'));", "v_name := btrim(v_list->>'n');"],
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
const ANN = "22222222-0000-0000-0000-000000000001";
const TEST = "22222222-0000-0000-0000-000000000002";

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  INSERT INTO auth.users VALUES ('${ANN}'), ('${TEST}');
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  INSERT INTO public.test_accounts VALUES ('${TEST}');
  CREATE FUNCTION public.is_test_member(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p) $f$;
`);
await db.exec(readFileSync(MIG_DIR + BASE, "utf8"));
if (process.env.NEW_MIGRATION !== "skip") for (let k = 0; k < 3; k++) await db.exec(mig);

const as = async (uid, addr, origin) => {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid ?? ""]);
  await db.query(`SELECT set_config('request.headers', $1, false)`, [JSON.stringify({ "x-forwarded-for": `9.9.9.9, ${addr ?? "1.1.1.1"}`, ...(origin ? { origin } : {}) })]);
};
const share = async (lists, test) => {
  try {
    const r = await db.query(`SELECT public.gift_wish_lists_share($1::jsonb, $2) AS c`, [JSON.stringify(lists), test ?? false]);
    return { code: r.rows[0].c };
  } catch (e) {
    return { err: String(e.message) };
  }
};
const save = async (name, items) => {
  try { return { code: (await db.query(`SELECT public.gift_wish_list_save($1, $2::jsonb) AS c`, [name, JSON.stringify(items)])).rows[0].c }; } catch (e) { return { err: String(e.message) }; }
};
const get = async (code) => {
  try { return (await db.query(`SELECT public.gift_wish_list_get($1) AS l`, [code])).rows[0].l; } catch (e) { return { err: String(e.message) }; }
};
const A = { g: "her", i: "abc123" };
const B = { g: "kids", i: "z9" };
const C = { g: "black-friday-cyber-monday", i: "d1" };

// A guest shares two people's lists (and one empty one, left out).
await as(null, "2.2.2.2");
const s1 = await share([{ n: "Mom", items: [A, B, A] }, { n: "Dad", items: [] }, { n: "Jake", items: [C] }]);
check(/^[a-z0-9]{12}$/.test(s1.code ?? ""), `a share returns a 12-char code (${JSON.stringify(s1)})`);
const l1 = await get(s1.code ?? "none");
check(JSON.stringify(l1?.lists) === JSON.stringify([{ n: "Mom", items: [A, B] }, { n: "Jake", items: [C] }]), `lists read back by code: names + refs, each ref once, empty lists left out (${JSON.stringify(l1?.lists)})`);
check(l1 && Object.keys(l1).sort().join(",") === "items,lists,name,updated_at", "the read carries name, items, lists and updated_at only");
check(JSON.stringify(l1?.items) === "[]", "a lists share holds no single-list items");

// A wish list link made the old way reads exactly as before.
const w1 = await save("Lexi's list", [A]);
const wl = await get(w1.code ?? "");
check(wl?.name === "Lexi's list" && wl && Object.keys(wl).sort().join(",") === "items,name,updated_at", `an old-style wish list reads as before, no lists key (${JSON.stringify(wl)})`);

// Refusals.
check(/invalid_items/.test((await share([{ n: "Mom", items: [{ g: "her", i: "BAD!" }] }])).err ?? ""), "a bad item id is refused");
check(/invalid_items/.test((await share([{ n: "Mom", items: [A], budget: 50 }])).err ?? ""), "an extra key on a list (a budget) is refused");
check(/invalid_items/.test((await share(Array.from({ length: 51 }, (_, k) => ({ n: `P${k}`, items: [A] })))).err ?? ""), "51 lists are refused");
check(/invalid_items/.test((await share([{ n: "Mom", items: Array.from({ length: 101 }, (_, k) => ({ g: "her", i: `a${k}` })) }])).err ?? ""), "101 refs in one list are refused");
check(/invalid_items/.test((await share([])).err ?? ""), "no lists at all is refused");
check(/empty_list/.test((await share([{ n: "Mom", items: [] }])).err ?? ""), "lists with no gift are refused (empty_list)");
for (const bad of ["see www.example.com", "Win at evil.com", "Call 337 555 1234", "x".repeat(41)]) {
  check(/invalid_name/.test((await share([{ n: bad, items: [A] }])).err ?? ""), `list name refused: ${bad.slice(0, 30)}`);
}
const bidi = await share([{ n: "Mom\u202e\u200b\u0007", items: [A] }]);
check((await get(bidi.code ?? ""))?.lists?.[0]?.n === "Mom", "invisible and direction-changing characters are stripped from a list name");

// Rate limit, shared with gift_wish_list_save: 4 good calls from 2.2.2.2 so far (s1, w1, bidi... refusals not counted).
await db.exec(`DELETE FROM public.gift_wish_list_hits`);
await as(null, "3.3.3.3");
for (let k = 0; k < 5; k++) await save("x", [A]);
let last;
for (let k = 0; k < 5; k++) last = await share([{ n: "Mom", items: [A] }]);
check(!!last.code, "the 10th save-or-share from one address passes");
check(/rate_limited/.test((await share([{ n: "Mom", items: [A] }])).err ?? ""), "the 11th from one address in 10 minutes is refused (one budget with gift_wish_list_save)");

// At most 300 gifts across the lists.
await db.exec(`DELETE FROM public.gift_wish_list_hits`);
await as(null, "3.3.3.4");
const big = (k) => ({ n: `P${k}`, items: Array.from({ length: 100 }, (_, j) => ({ g: "her", i: `b${k}x${j}` })) });
check(!!(await share([big(1), big(2), big(3)])).code, "300 gifts across three lists save");
check(/invalid_items/.test((await share([big(1), big(2), big(3), { n: "P4", items: [A] }])).err ?? ""), "301 gifts across the lists are refused");

// Signed in: a snapshot, never the account's own wish list row; 10 shares per 10 minutes, as a guest.
await as(ANN, "4.4.4.4");
const own = await save("Ann's list", [A]);
const s2 = await share([{ n: "Mom", items: [B] }]);
check(!!s2.code && s2.code !== own.code, "an account's share is a new code, not its wish list's");
const annRow = (await db.query(`SELECT items, lists FROM public.gift_wish_lists WHERE user_id = '${ANN}'`)).rows;
check(annRow.length === 1 && annRow[0].lists === null && JSON.stringify(annRow[0].items) === JSON.stringify([A]), `the account's wish list row is untouched (${JSON.stringify(annRow)})`);
check((await db.query(`SELECT user_id FROM public.gift_wish_lists WHERE code = $1`, [s2.code])).rows[0]?.user_id === null, "the share is a snapshot (user_id NULL)");
for (let k = 0; k < 8; k++) await share([{ n: "Mom", items: [B] }]);
check(/rate_limited/.test((await share([{ n: "Mom", items: [B] }])).err ?? ""), "an account's 11th save-or-share in 10 minutes is refused (shares get no account bonus)");

// is_seed.
await as(TEST, "5.5.5.5");
const t1 = await share([{ n: "Mom", items: [A] }]);
check((await db.query(`SELECT is_seed FROM public.gift_wish_lists WHERE code = $1`, [t1.code])).rows[0]?.is_seed === true, "a test account's share is is_seed");
await as(null, "5.5.5.6");
const t2 = await share([{ n: "Mom", items: [A] }], true);
check((await db.query(`SELECT is_seed FROM public.gift_wish_lists WHERE code = $1`, [t2.code])).rows[0]?.is_seed === true, "a test browser's share (p_test) is is_seed");
const t3 = await share([{ n: "Mom", items: [A] }]);
check((await db.query(`SELECT is_seed FROM public.gift_wish_lists WHERE code = $1`, [t3.code])).rows[0]?.is_seed === false, "a real visitor's share is not is_seed");

// The daily prune removes old shares.
await db.query(`UPDATE public.gift_wish_lists SET created_at = now() - interval '91 days' WHERE code = $1`, [t3.code]);
await db.query(`SELECT public.gift_wish_list_prune()`);
check((await get(t3.code)) === null, "a share older than 90 days is pruned");

// Privileges: the table stays function-only; the new function is callable by anon and authenticated.
const priv = (await db.query(`SELECT has_table_privilege('anon', 'public.gift_wish_lists', 'SELECT') AS a, has_table_privilege('authenticated', 'public.gift_wish_lists', 'SELECT') AS u, has_function_privilege('anon', 'public.gift_wish_lists_share(jsonb, boolean)', 'EXECUTE') AS f`)).rows[0];
check(priv.a === false && priv.u === false, `anon and authenticated hold no table privilege (${JSON.stringify(priv)})`);
check(priv.f === true, "anon may call gift_wish_lists_share");
const pub = (await db.query(`SELECT proacl::text AS acl FROM pg_proc WHERE proname = 'gift_wish_lists_share'`)).rows[0].acl;
check(!/(^|[{,])=X/.test(pub), `PUBLIC holds no EXECUTE (${pub})`);

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * PGlite proof for 20261122024017_gift_wish_list_delete (holiday audit 1121: "No way to delete a wish list or stop a
 * shared link"): a signed-in member deletes their own list (and only theirs); the browser that made a guest snapshot
 * claims it once, within 10 minutes, with a token whose hash is stored, and can then stop the link; a wrong token, a
 * second claim, a late claim, an account's row and bad input are all refused; anon and authenticated hold no table
 * privilege.
 *
 *   node src/test/pglite/giftWishListDelete.pglite.mjs                    # ALL PASS (new migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/giftWishListDelete.pglite.mjs # RED
 *   MUTANT=<name> node ...                                                # each must FAIL (see MUTANTS)
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const files = readdirSync(MIG_DIR);
const BASE = files.find((f) => f.endsWith("_gift_wish_lists.sql"));
const THIS = files.find((f) => f.endsWith("_gift_wish_list_delete.sql"));
if (!BASE || !THIS) throw new Error("migration not found");

const MUTANTS = {
  deleteAnyone: ["  DELETE FROM public.gift_wish_lists w WHERE w.user_id = v_uid;", "  DELETE FROM public.gift_wish_lists w WHERE w.user_id IS NOT NULL;"],
  deleteAnon: ["  IF v_uid IS NULL THEN\n    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';\n  END IF;\n  DELETE", "  DELETE"],
  claimLate: ["   WHERE w.code = p_code AND w.user_id IS NULL AND w.created_at > now() - interval '60 seconds'", "   WHERE w.code = p_code AND w.user_id IS NULL"],
  claimAccount: ["   WHERE w.code = p_code AND w.user_id IS NULL AND w.created_at", "   WHERE w.code = p_code AND w.created_at"],
  claimTwice: ["  ON CONFLICT (code) DO NOTHING;", "  ON CONFLICT (code) DO UPDATE SET token_hash = EXCLUDED.token_hash;"],
  unshareAnyToken: ["     AND o.code = w.code AND o.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');", "     AND o.code = w.code;"],
  unshareAccount: ["   WHERE w.code = p_code AND w.user_id IS NULL\n     AND o.code", "   WHERE w.code = p_code\n     AND o.code"],
  plainToken: ["  SELECT w.code, encode(sha256(convert_to(p_token, 'UTF8')), 'hex')", "  SELECT w.code, p_token"],
  anonTable: ["REVOKE ALL ON TABLE public.gift_wish_list_owners FROM PUBLIC, anon, authenticated;", "GRANT SELECT ON TABLE public.gift_wish_list_owners TO anon;"],
  anonDelete: ["REVOKE ALL ON FUNCTION public.gift_wish_list_delete() FROM PUBLIC, anon, authenticated;", "GRANT EXECUTE ON FUNCTION public.gift_wish_list_delete() TO anon;"],
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
const ANN = "44444444-0000-0000-0000-000000000001";
const BOB = "44444444-0000-0000-0000-000000000002";

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  INSERT INTO auth.users VALUES ('${ANN}'), ('${BOB}');
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  CREATE FUNCTION public.is_test_member(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p) $f$;
`);
await db.exec(readFileSync(MIG_DIR + BASE, "utf8"));
if (process.env.NEW_MIGRATION !== "skip") for (let k = 0; k < 3; k++) await db.exec(mig);

const as = async (uid, addr) => {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid ?? ""]);
  await db.query(`SELECT set_config('request.headers', $1, false)`, [JSON.stringify({ "x-forwarded-for": addr ?? "1.1.1.1" })]);
};
const call = async (sql, params) => {
  try { return { v: (await db.query(sql, params)).rows[0]?.v }; } catch (e) { return { err: String(e.message) }; }
};
const A = { g: "her", i: "abc123" };
const save = async () => (await call(`SELECT public.gift_wish_list_save($1, $2::jsonb) AS v`, ["List", JSON.stringify([A])])).v;
const exists = async (code) => (await db.query(`SELECT 1 FROM public.gift_wish_lists WHERE code = $1`, [code])).rows.length === 1;
const T1 = "a".repeat(64);
const T2 = "b".repeat(64);

// A guest makes a snapshot and claims it.
await as(null, "2.2.2.2");
const s1 = await save();
check(/^[a-z0-9]{12}$/.test(s1 ?? ""), "a guest snapshot is made");
check((await call(`SELECT public.gift_wish_list_claim($1, $2) AS v`, [s1, T1])).v === true, "the browser that made it claims it");
check((await call(`SELECT public.gift_wish_list_claim($1, $2) AS v`, [s1, T2])).v === false, "a second claim (someone who saw the code) is refused");
const stored = (await db.query(`SELECT token_hash FROM public.gift_wish_list_owners WHERE code = $1`, [s1])).rows[0]?.token_hash;
check(stored && stored !== T1 && /^[0-9a-f]{64}$/.test(stored), "only the token's hash is stored, never the token");
check((await call(`SELECT public.gift_wish_list_unshare($1, $2) AS v`, [s1, T2])).v === false && (await exists(s1)), "a wrong token stops nothing");
check((await call(`SELECT public.gift_wish_list_unshare($1, $2) AS v`, [s1, T1])).v === true && !(await exists(s1)), "the right token stops the link (the list is deleted)");
check((await db.query(`SELECT 1 FROM public.gift_wish_list_owners WHERE code = $1`, [s1])).rows.length === 0, "its claim goes with it");

// A late claim and an unclaimed snapshot.
await db.exec(`DELETE FROM public.gift_wish_list_hits`);
const s2 = await save();
await db.query(`UPDATE public.gift_wish_lists SET created_at = now() - interval '61 seconds' WHERE code = $1`, [s2]);
check((await call(`SELECT public.gift_wish_list_claim($1, $2) AS v`, [s2, T1])).v === false, "a claim more than 60 seconds after the snapshot is refused");
check((await call(`SELECT public.gift_wish_list_unshare($1, $2) AS v`, [s2, T1])).v === false && (await exists(s2)), "an unclaimed snapshot cannot be stopped by anyone");

// Accounts: delete their own list only; their row is never claimable or unsharable.
await as(ANN, "3.3.3.3");
const annCode = await save();
await as(BOB, "4.4.4.4");
const bobCode = await save();
check((await call(`SELECT public.gift_wish_list_claim($1, $2) AS v`, [bobCode, T1])).v === false, "an account's own list cannot be claimed");
await db.query(`INSERT INTO public.gift_wish_list_owners (code, token_hash) VALUES ($1, encode(sha256(convert_to($2, 'UTF8')), 'hex'))`, [annCode, T2]);
check((await call(`SELECT public.gift_wish_list_unshare($1, $2) AS v`, [annCode, T2])).v === false && (await exists(annCode)), "an account's list is never deleted by unshare, even with a matching hash");
check((await call(`SELECT public.gift_wish_list_delete() AS v`)).v === true && !(await exists(bobCode)) && (await exists(annCode)), "a member deletes their own list and no one else's");
check((await call(`SELECT public.gift_wish_list_delete() AS v`)).v === false, "deleting again finds nothing");
await as(null, "5.5.5.5");
check(/not_authenticated/.test((await call(`SELECT public.gift_wish_list_delete() AS v`)).err ?? ""), "signed out, delete is refused");
check(/invalid_token/.test((await call(`SELECT public.gift_wish_list_unshare($1, $2) AS v`, ["BAD", T1])).err ?? ""), "a bad code is refused");
check(/invalid_token/.test((await call(`SELECT public.gift_wish_list_claim($1, $2) AS v`, [s2, "short"])).err ?? ""), "a bad token is refused");

// Privileges.
const priv = (await db.query(`SELECT has_table_privilege('anon', 'public.gift_wish_list_owners', 'SELECT') AS a, has_table_privilege('authenticated', 'public.gift_wish_list_owners', 'SELECT') AS u,
  has_function_privilege('anon', 'public.gift_wish_list_delete()', 'EXECUTE') AS d, has_function_privilege('anon', 'public.gift_wish_list_unshare(text, text)', 'EXECUTE') AS un,
  has_function_privilege('anon', 'public.gift_wish_list_claim(text, text)', 'EXECUTE') AS c`)).rows[0];
check(priv.a === false && priv.u === false, `no client table privilege on the claims (${JSON.stringify(priv)})`);
check(priv.d === false && priv.un === true && priv.c === true, "anon may claim and unshare, never delete an account's list");

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

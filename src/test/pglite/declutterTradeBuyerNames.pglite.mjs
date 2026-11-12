#!/usr/bin/env node
/**
 * PGlite proof for 20261112004253 (F356 follow-up, trades): declutter_my_trade_buyer_names() gives the CALLER, as seller,
 * each open/accepted trade offer's trader as first name + last initial ("Ann S."), and nothing else: no row for a trade
 * where the caller is the buyer, none for another seller's trades or for a closed one, NULL for a blank name or a gone
 * profile, never the full name or any id beyond the trade's own.
 *
 *   node src/test/pglite/declutterTradeBuyerNames.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/declutterTradeBuyerNames.pglite.mjs # RED: no such function
 *   MUTANT=anySeller|fullName|anyStatus|anonToo node ...                         # each must FAIL
 *
 * World: profiles and declutter_swap_offers with the columns read; member_display_name VERBATIM from 20261021131322.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_trade_buyer_names.sql"));
if (!THIS) throw new Error("migration not found");
const NAMES = readFileSync(MIG_DIR + "20261021131322_member_names_first_and_initial.sql", "utf8");
const ns = NAMES.indexOf("CREATE OR REPLACE FUNCTION public.member_display_name");
const memberDisplayName = NAMES.slice(ns, NAMES.indexOf("$fn$;", ns) + 5);

const MUTANTS = {
  anySeller: ["   WHERE s.seller_id = (SELECT auth.uid())\n", "   WHERE true\n"],
  fullName: ["SELECT s.id, public.member_display_name(bp.full_name, NULL)::text", "SELECT s.id, bp.full_name::text"],
  anyStatus: ["     AND s.status IN ('open', 'accepted')\n", ""],
  anonToo: ["GRANT EXECUTE ON FUNCTION public.declutter_my_trade_buyer_names() TO authenticated, service_role;", "GRANT EXECUTE ON FUNCTION public.declutter_my_trade_buyer_names() TO anon, authenticated, service_role;"],
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
const U = (n) => `11111111-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const SAM = U(1), ANN = U(2), BLANK = U(3), GONE = U(4), OTHER = U(5);
const S = (n) => `33333333-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  GRANT USAGE ON SCHEMA auth, public TO authenticated, anon;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, email text, avatar_url text);
  REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated;
  CREATE TABLE public.declutter_swap_offers (id uuid PRIMARY KEY, item_id uuid, offered_item_id uuid, buyer_id uuid, seller_id uuid,
    status text, created_at timestamptz NOT NULL DEFAULT now());
  REVOKE ALL ON public.declutter_swap_offers FROM PUBLIC, anon, authenticated;
  ${memberDisplayName}
  REVOKE ALL ON FUNCTION public.member_display_name(text, text) FROM PUBLIC, anon;
  INSERT INTO public.profiles (user_id, full_name, email, avatar_url) VALUES
    ('${SAM}', 'Sam Seller', 'sam@example.com', NULL), ('${ANN}', '  Ann Marie  Savoie ', 'ann@example.com', 'https://x/a.jpg'),
    ('${BLANK}', '   ', 'b@example.com', NULL), ('${OTHER}', 'Olga Other', 'o@example.com', NULL);
  INSERT INTO public.declutter_swap_offers (id, item_id, offered_item_id, buyer_id, seller_id, status) VALUES
    ('${S(1)}', gen_random_uuid(), gen_random_uuid(), '${ANN}', '${SAM}', 'open'),
    ('${S(2)}', gen_random_uuid(), gen_random_uuid(), '${ANN}', '${SAM}', 'accepted'),
    ('${S(3)}', gen_random_uuid(), gen_random_uuid(), '${ANN}', '${SAM}', 'declined'),
    ('${S(4)}', gen_random_uuid(), gen_random_uuid(), '${BLANK}', '${SAM}', 'open'),
    ('${S(5)}', gen_random_uuid(), gen_random_uuid(), '${GONE}', '${SAM}', 'open'),
    ('${S(6)}', gen_random_uuid(), gen_random_uuid(), '${SAM}', '${OTHER}', 'open'),
    ('${S(7)}', gen_random_uuid(), gen_random_uuid(), '${ANN}', '${OTHER}', 'open');
`);

const runs = process.env.NEW_MIGRATION === "skip" ? 0 : 3;
let applyError = null;
for (let i = 0; i < runs; i++) {
  try { await db.exec(mig); } catch (e) { applyError = String(e.message ?? e); break; }
}
check(applyError === null, `applied ${THIS} x${runs} -> ${applyError ?? "ok"}`);

async function as(role, uid, sql) {
  await db.exec("BEGIN");
  try {
    await db.exec(`SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', true);`);
    const r = await db.query(sql);
    await db.exec("COMMIT");
    return { rows: r.rows, fields: r.fields.map((f) => f.name) };
  } catch (e) {
    await db.exec("ROLLBACK");
    return { error: String(e.message ?? e) };
  }
}
const names = (uid, role = "authenticated") => as(role, uid, "SELECT * FROM public.declutter_my_trade_buyer_names()");

const sam = await names(SAM);
const byId = Object.fromEntries((sam.rows ?? []).map((r) => [r.swap_id, r.buyer_display]));
check(!sam.error && JSON.stringify(sam.fields) === '["swap_id","buyer_display"]', `exactly two fields -> ${sam.error ?? sam.fields?.join(",")}`);
check(byId[S(1)] === "Ann S." && byId[S(2)] === "Ann S.", `open and accepted trades name the trader "Ann S." -> ${JSON.stringify(byId)}`);
check(!(S(3) in byId), "a closed (declined) trade gives no row");
check(S(4) in byId && byId[S(4)] === null, `a blank name -> NULL -> ${JSON.stringify(byId[S(4)])}`);
check(S(5) in byId && byId[S(5)] === null, `a gone profile -> NULL -> ${JSON.stringify(byId[S(5)])}`);
check(!(S(6) in byId) && !(S(7) in byId), "no row for a trade where Sam is the buyer, nor for another seller's trade");
const body = JSON.stringify(sam.rows ?? []);
for (const secret of ["Savoie", "Marie", "ann@example.com", "a.jpg", ANN, "Olga"]) check(!body.includes(secret), `the response holds no "${secret}"`);

const ann = await names(ANN);
check(!ann.error && ann.rows.length === 0, `the trader (a buyer only) gets nothing -> ${ann.error ?? ann.rows.length}`);
const other = await names(OTHER);
check(!other.error && other.rows.length === 2 && other.rows.every((r) => r.buyer_display === "Ann S." || r.buyer_display === "Sam S."),
  `Olga sees only her own two trades' traders -> ${other.error ?? JSON.stringify(other.rows)}`);
const nobody = await names(null);
check(!nobody.error && nobody.rows.length === 0, `no caller id -> no rows -> ${nobody.error ?? nobody.rows.length}`);
const anon = await names(null, "anon");
check(/permission denied/.test(anon.error ?? ""), `anon cannot call it -> ${anon.error ?? "ALLOWED"}`);
const acl = (await db.query(`SELECT to_regprocedure('public.declutter_my_trade_buyer_names()') IS NULL AS gone`)).rows[0].gone ? {}
  : (await db.query(`SELECT (SELECT prosecdef FROM pg_proc WHERE proname = 'declutter_my_trade_buyer_names') AS d`)).rows[0];
check(acl.d === true, `SECURITY DEFINER -> ${JSON.stringify(acl)}`);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);

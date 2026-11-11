#!/usr/bin/env node
/**
 * PGlite proof for 20261111204024 (F360a, owner 11-11): the buyer who reported an open problem saves "Refund me" or
 * "Swap / fix it" (declutter_problem_set_wants); the order's two sides read it (column grant under the existing RLS);
 * nobody else can set it, nothing else on the row moves, and no UPDATE grant opens.
 *
 *   node src/test/pglite/declutterProblemBuyerWants.pglite.mjs                    # after (3x replay): ALL PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterProblemBuyerWants.pglite.mjs # the before: must FAIL
 *   MUTANT=anyReporter node ...                                                   # drops the buyer-only test: must FAIL
 *   MUTANT=closedToo node ...                                                     # drops the open-only test: must FAIL
 *   MUTANT=anyReason node ...                                                     # drops the item-reasons test: must FAIL
 *
 * World: declutter_problems' columns and authenticated's column grants as in the decide_by proof
 * (declutterProblemsDecideByGrant.pglite.mjs, read from prod 2026-11-03) plus decide_by, RLS on, the read policy,
 * has_role / is_caller_banned stubbed.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_declutter_problem_buyer_wants.sql"));
if (!THIS) throw new Error("migration not found");

const MUTANTS = {
  anyReporter: ["OR p.reporter_id IS DISTINCT FROM v_uid OR p.reporter_side <> 'buyer' THEN", "THEN"],
  closedToo: ["IF p.status <> 'open' THEN", "IF false THEN"],
  anyReason: ["IF p.reason NOT IN ('damaged', 'not_as_described', 'other') THEN", "IF false THEN"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
const MUTANT = process.env.MUTANT ?? "";
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const BUYER = "11111111-0000-0000-0000-000000000002";
const SELLER = "11111111-0000-0000-0000-000000000003";
const STRANGER = "11111111-0000-0000-0000-000000000009";
const ORDER = "33333333-0000-0000-0000-000000000001";
const P_BUYER = "44444444-0000-0000-0000-000000000001";
const P_SELLER = "44444444-0000-0000-0000-000000000002";
const P_CLOSED = "44444444-0000-0000-0000-000000000003";
const ORDER2 = "33333333-0000-0000-0000-000000000002";
const P_NOSHOW = "44444444-0000-0000-0000-000000000004";

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  GRANT USAGE ON SCHEMA auth, public TO authenticated, anon;
  CREATE FUNCTION public.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;
  GRANT EXECUTE ON FUNCTION public.has_role(uuid, text), public.is_caller_banned() TO authenticated;
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid);
  GRANT SELECT ON public.declutter_orders TO authenticated;
  CREATE TABLE public.declutter_problems (
    id uuid PRIMARY KEY, order_id uuid NOT NULL, reporter_id uuid, reporter_side text NOT NULL,
    reason text NOT NULL, note text NOT NULL, photo_paths text[] NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'open', decision text, fault text, strike_given boolean NOT NULL DEFAULT false,
    admin_note text, decided_by uuid, decided_at timestamptz, is_seed boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(), decide_by timestamptz, other_side_at timestamptz,
    other_side_note text, other_side_photo_paths text[], withdrawn_at timestamptz);
  ALTER TABLE public.declutter_problems ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.declutter_problems FROM PUBLIC, anon, authenticated;
  GRANT SELECT (admin_note, created_at, decided_at, decision, fault, id, is_seed, note, order_id, photo_paths,
                reason, reporter_id, reporter_side, status, strike_given, decide_by) ON TABLE public.declutter_problems TO authenticated;
  CREATE POLICY "declutter problems: the two sides and admins read" ON public.declutter_problems
    FOR SELECT TO authenticated
    USING (public.has_role((SELECT auth.uid()), 'admin')
           OR EXISTS (SELECT 1 FROM public.declutter_orders o
                       WHERE o.id = declutter_problems.order_id
                         AND (o.buyer_id = (SELECT auth.uid()) OR o.seller_id = (SELECT auth.uid()))));
  INSERT INTO public.declutter_orders VALUES ('${ORDER}', '${BUYER}', '${SELLER}'), ('${ORDER2}', '${BUYER}', '${SELLER}');
  INSERT INTO public.declutter_problems (id, order_id, reporter_id, reporter_side, reason, note, status) VALUES
    ('${P_BUYER}', '${ORDER}', '${BUYER}', 'buyer', 'damaged', 'cracked', 'open'),
    ('${P_SELLER}', '${ORDER}', '${SELLER}', 'seller', 'no_show', 'never came', 'open'),
    ('${P_CLOSED}', '${ORDER}', '${BUYER}', 'buyer', 'damaged', 'old one', 'decided'),
    ('${P_NOSHOW}', '${ORDER2}', '${BUYER}', 'buyer', 'not_received', 'never came', 'open');
`);

const runs = process.env.NEW_MIGRATION === "skip" ? 0 : 3;
let applyError = null;
for (let i = 0; i < runs; i++) {
  try { await db.exec(mig); } catch (e) { applyError = String(e.message ?? e); break; }
}
check(applyError === null, `applied ${THIS} x${runs} -> ${applyError ?? "ok"}`);

async function as(uid, sql) {
  await db.exec("BEGIN");
  try {
    await db.exec(`SET LOCAL ROLE ${uid ? "authenticated" : "anon"}; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', true);`);
    const r = await db.query(sql);
    await db.exec("COMMIT");
    return { rows: r.rows };
  } catch (e) {
    await db.exec("ROLLBACK");
    return { error: String(e.message ?? e) };
  }
}
const before = (await db.query(`SELECT * FROM public.declutter_problems WHERE id = '${P_BUYER}'`)).rows[0];

const set = await as(BUYER, `SELECT public.declutter_problem_set_wants('${P_BUYER}', 'swap_fix') AS r`);
check(!set.error && set.rows[0]?.r === "swap_fix", `the reporting buyer saves "swap_fix" -> ${set.error ?? JSON.stringify(set.rows)}`);
const sellerReads = await as(SELLER, `SELECT buyer_wants FROM public.declutter_problems WHERE id = '${P_BUYER}'`);
check(!sellerReads.error && sellerReads.rows[0]?.buyer_wants === "swap_fix", `the seller reads it -> ${sellerReads.error ?? JSON.stringify(sellerReads.rows)}`);
const strangerReads = await as(STRANGER, `SELECT buyer_wants FROM public.declutter_problems`);
check(!strangerReads.error && strangerReads.rows.length === 0, `a stranger reads no row (RLS) -> ${strangerReads.error ?? strangerReads.rows.length}`);
const after = (await db.query(`SELECT * FROM public.declutter_problems WHERE id = '${P_BUYER}'`)).rows[0];
const moved = Object.keys(before).filter((k) => k !== "buyer_wants" && JSON.stringify(before[k]) !== JSON.stringify(after[k]));
check(moved.length === 0, `nothing else on the row moved -> ${moved.join(",") || "none"}`);
const change = await as(BUYER, `SELECT public.declutter_problem_set_wants('${P_BUYER}', 'refund') AS r`);
check(!change.error && change.rows[0]?.r === "refund", `the buyer may change it while open -> ${change.error ?? "ok"}`);

const bySeller = await as(SELLER, `SELECT public.declutter_problem_set_wants('${P_BUYER}', 'swap_fix')`);
check(/item_not_found/.test(bySeller.error ?? ""), `the seller cannot set the buyer's choice -> ${bySeller.error ?? "ALLOWED"}`);
const onSellerReport = await as(SELLER, `SELECT public.declutter_problem_set_wants('${P_SELLER}', 'refund')`);
check(/item_not_found/.test(onSellerReport.error ?? ""), `not on a seller's own report -> ${onSellerReport.error ?? "ALLOWED"}`);
const byStranger = await as(STRANGER, `SELECT public.declutter_problem_set_wants('${P_BUYER}', 'refund')`);
check(/item_not_found/.test(byStranger.error ?? ""), `a stranger cannot -> ${byStranger.error ?? "ALLOWED"}`);
const closed = await as(BUYER, `SELECT public.declutter_problem_set_wants('${P_CLOSED}', 'refund')`);
check(/problem_not_open/.test(closed.error ?? ""), `not once the problem is decided -> ${closed.error ?? "ALLOWED"}`);
const bad = await as(BUYER, `SELECT public.declutter_problem_set_wants('${P_BUYER}', 'money')`);
check(/invalid_choice/.test(bad.error ?? ""), `only the two choices -> ${bad.error ?? "ALLOWED"}`);
const noShow = await as(BUYER, `SELECT public.declutter_problem_set_wants('${P_NOSHOW}', 'swap_fix')`);
check(/invalid_choice/.test(noShow.error ?? ""), `not on a report with no item to swap (not_received) -> ${noShow.error ?? "ALLOWED"}`);
const anon = await as(null, `SELECT public.declutter_problem_set_wants('${P_BUYER}', 'refund')`);
check(/permission denied/.test(anon.error ?? ""), `anon cannot call it -> ${anon.error ?? "ALLOWED"}`);
const directUpdate = await as(BUYER, `UPDATE public.declutter_problems SET buyer_wants = 'swap_fix' WHERE id = '${P_BUYER}'`);
check(/permission denied/.test(directUpdate.error ?? ""), `no direct UPDATE grant -> ${directUpdate.error ?? "ALLOWED"}`);
const oldReads = await as(BUYER, "SELECT id, order_id, reporter_side, reason FROM public.declutter_problems WHERE status = 'open'");
check(!oldReads.error && oldReads.rows.length === 3, `the existing open-problems read still works -> ${oldReads.error ?? oldReads.rows.length}`);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);

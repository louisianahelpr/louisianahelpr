#!/usr/bin/env node
/**
 * PGlite proof for 20261102071958_gift_restore_exact_cents (Q1914): restore_gift_card_for_job takes p_restore_cents, an
 * exact number of cents to give back (capped to what the gift paid toward the job), so a gift returned less a fee keeps
 * exactly the fee (before: a $330 gift less $150 could only keep a whole-basis-point share, $150.02).
 *
 *   node src/test/pglite/giftRestoreExactCents.pglite.mjs                     # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/giftRestoreExactCents.pglite.mjs  # RED: the old function
 *   MUTANT=<name> node src/test/pglite/giftRestoreExactCents.pglite.mjs       # a planted defect: must FAIL
 *
 * Real: the migration verbatim (3x) on top of the old function (20260922165121, its newest definition), so the DROP of
 * the old signature is exercised. Tables reduced to the columns read. Supabase's default anon/authenticated EXECUTE
 * grant is emulated. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102071958_gift_restore_exact_cents.sql";
const OLD = "20260922165121_revoked_gift_cannot_be_reminted.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The exact cents ignored (the bps share always).
  ignored: ["  v_restore_cents := CASE WHEN p_restore_cents IS NOT NULL THEN", "  v_restore_cents := CASE WHEN false THEN"],
  // Not capped to what the gift paid.
  uncapped: ["least(greatest(p_restore_cents, 0), v_applied_cents)", "greatest(p_restore_cents, 0)"],
  // The old signature left beside the new one (named calls go ambiguous).
  keepOld: ["DROP FUNCTION IF EXISTS public.restore_gift_card_for_job(uuid, integer, boolean);", ""],
  // Left open to members.
  openGrant: ["REVOKE ALL ON FUNCTION public.restore_gift_card_for_job(uuid, integer, boolean, integer) FROM PUBLIC, anon, authenticated;", ""],
  // A reserved gift partly unreserved by an exact amount.
  partialUnreserve: ["    IF v_share_bps < 10000 OR (p_restore_cents IS NOT NULL AND p_restore_cents < round(v_credit.amount * 100)::int) THEN", "    IF v_share_bps < 10000 THEN"],
};
if (MUTANT && !MUTANTS[MUTANT]) throw new Error(`unknown MUTANT ${MUTANT}`);

function oldDef() {
  const sql = readFileSync(MIG_DIR + OLD, "utf8");
  const a = sql.indexOf("create or replace function public.restore_gift_card_for_job(");
  const b = sql.indexOf("$function$;", a) + "$function$;".length;
  return sql.slice(a, b);
}

let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `efefefef-0000-0000-0000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.jobs (id uuid PRIMARY KEY);
CREATE TABLE public.gift_cards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), donor_id uuid, recipient_id uuid, recipient_email text,
  amount numeric, status text, payment_status text, category text, message text, occasion text, design_id text, job_id uuid,
  parent_credit_id uuid, restored_from_job_id uuid UNIQUE, expires_at timestamptz, created_at timestamptz DEFAULT now());
`);
await db.exec(oldDef());
await db.exec(`REVOKE ALL ON FUNCTION public.restore_gift_card_for_job(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;`);
if (!skip) {
  let sql = readFileSync(MIG_DIR + THIS, "utf8");
  if (MUTANT) {
    const [find, repl] = MUTANTS[MUTANT];
    if (!sql.includes(find)) throw new Error(`MUTANT ${MUTANT}: text not found`);
    sql = sql.replace(find, repl);
  }
  let applied = true;
  for (let i = 0; i < 3; i++) { try { await db.exec(sql); } catch (e) { applied = false; check(false, `migration applies (run ${i + 1})`, e.message); } }
  check(applied, "migration applies 3x");
}
const q = async (s, p = []) => (await db.query(s, p)).rows;
const call = async (args) => { try { return (await q(`SELECT public.restore_gift_card_for_job(${args}) AS r`))[0].r; } catch (e) { return { error: e.message }; } };
/** A $amount gift redeemed on a fresh job (status redeemed, applied in full). */
const giftOn = async (n, amount, status = "redeemed") => {
  await q(`INSERT INTO public.jobs VALUES ($1)`, [U(n)]);
  await q(`INSERT INTO public.gift_cards (donor_id, recipient_id, amount, status, payment_status, job_id) VALUES ($1, $2, $3, $4, 'paid', $5)`,
    [U(900), U(901), amount, status, U(n)]);
  return U(n);
};
const restoredCents = async (job) => Number((await q(`SELECT round(amount * 100)::int AS c FROM public.gift_cards WHERE restored_from_job_id = $1`, [job]))[0]?.c ?? -1);

// 1. The measured case: $330 gift less a $150 fee gives back exactly $180.00.
const j1 = await giftOn(1, 330);
const dry = await call(`p_job_id => '${j1}', p_dry_run => true, p_restore_cents => 18000`);
check(dry?.outcome === "would_restore" && dry.restore_cents === 18000 && dry.applied_cents === 33000, "dry run with exact cents: would_restore 18000 of 33000", JSON.stringify(dry));
const r1 = await call(`p_job_id => '${j1}', p_restore_cents => 18000`);
check(r1?.outcome === "restored" && r1.restore_cents === 18000 && await restoredCents(j1) === 18000,
  "a $330 gift less a $150 fee gives back exactly $180.00 (the fee kept is exactly $150)", JSON.stringify(r1));
// 2. Capped to what the gift paid.
const j2 = await giftOn(2, 50);
const r2 = await call(`p_job_id => '${j2}', p_restore_cents => 999999`);
check(r2?.restore_cents === 5000 && await restoredCents(j2) === 5000, "more than the gift paid is capped to the gift (5000)", JSON.stringify(r2));
// 3. Zero or below gives nothing back.
const j3 = await giftOn(3, 50);
const r3 = await call(`p_job_id => '${j3}', p_restore_cents => -5`);
check(r3?.outcome === "nothing_to_restore" && await restoredCents(j3) === -1, "a negative amount restores nothing", JSON.stringify(r3));
// 4. The old basis-point calls are unchanged (named arguments, as PostgREST sends them).
const j4 = await giftOn(4, 330);
const r4 = await call(`p_job_id => '${j4}', p_share_bps => 5454`);
check(r4?.outcome === "restored" && r4.restore_cents === 17998, "a p_share_bps call is unchanged (33000 * 5454 / 10000 = 17998)", JSON.stringify(r4));
const j5 = await giftOn(5, 20);
const r5 = await call(`p_job_id => '${j5}'`);
check(r5?.restore_cents === 2000, "a p_job_id-only call restores the whole gift", JSON.stringify(r5));
// 5. A reserved (not yet charged) gift is never partly unreserved by an exact amount.
const j6 = await giftOn(6, 40, "reserved");
const r6 = await call(`p_job_id => '${j6}', p_restore_cents => 1000`);
check(r6?.outcome === "partial_unreserve_unsupported", "a reserved gift and an exact amount below it: partial_unreserve_unsupported", JSON.stringify(r6));
// 6. One signature, service_role only.
const sigs = await q(`SELECT pg_get_function_identity_arguments(p.oid) AS a FROM pg_proc p WHERE p.proname = 'restore_gift_card_for_job'`);
check(sigs.length === 1, "exactly one restore_gift_card_for_job (no 3-argument overload left)", JSON.stringify(sigs));
const g = (await q(`SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS a, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS s FROM pg_proc p WHERE p.proname = 'restore_gift_card_for_job' LIMIT 1`))[0];
check(g && !g.a && !g.u && g.s, "grants: service_role only", JSON.stringify(g));

console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
process.exit(failures ? 1 : 0);

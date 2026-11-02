#!/usr/bin/env node
/**
 * PGlite proof for 20261102092917_phone_locked_against_grant_sync (Q1805 follow-up).
 *
 * The bug, measured on prod 2026-11-02: 20261102082018 REVOKEd UPDATE (phone)
 * from authenticated, and the sync-profiles-update-grants cron
 * (sync_profiles_update_grants(), 20260901011254) granted it straight back,
 * because phone was not in profiles_locked_update_columns().
 *
 * Fixture: a profiles table with prod's grant shape (table SELECT, column-level
 * UPDATE on the writable columns, phone included), the NEWEST
 * sync_profiles_update_grants() and profiles_locked_update_columns() as the
 * migrations define them, then 20261102082018's REVOKE, then the cron's call.
 *
 *   npx tsx src/test/pglite/phoneLockedAgainstGrantSync.pglite.mjs                     # GREEN, applied 3x
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/phoneLockedAgainstGrantSync.pglite.mjs  # RED: the list before it
 *   PLANT=no-sync npx tsx src/test/pglite/phoneLockedAgainstGrantSync.pglite.mjs       # RED: phone listed, sync never run
 *   PLANT=no-phone npx tsx src/test/pglite/phoneLockedAgainstGrantSync.pglite.mjs      # RED: sync run, phone not listed
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}

const ROOT = new URL("../../../", import.meta.url).pathname;
const DIR = `${ROOT}supabase/migrations/`;
const THIS = "20261102092917_phone_locked_against_grant_sync.sql";
const MODE = process.env.NEW_MIGRATION ?? "";
const PLANT = process.env.PLANT ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: the state BEFORE ${THIS} (expect FAILs)`);
if (PLANT) console.log(`PLANT=${PLANT} (expect FAILs)`);

const before = effectiveDefs(DIR, { before: THIS });
const SYNC = before.get("sync_profiles_update_grants");
if (!SYNC) throw new Error("no sync_profiles_update_grants definition before this migration");

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

const db = new PGlite();
await db.exec(`
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  END $r$;
  CREATE TABLE public.profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, phone text, bio text, full_name text,
    subscription_tier text, subscription_expires_at timestamptz, stripe_customer_id text, stripe_subscription_id text,
    subscription_billing_cycle text, subscription_cancel_at_period_end boolean, apple_original_transaction_id text,
    boost_credit_used_month text, created_at timestamptz DEFAULT now(), email text, anonymized_at timestamptz,
    boost_credit_used_count int, ban_status text, auto_suspended_until timestamptz, promotions_before_unsubscribe jsonb
  );
  GRANT SELECT ON public.profiles TO anon, authenticated;
  GRANT UPDATE (phone, bio, full_name) ON public.profiles TO authenticated;
`);
await db.exec(SYNC.stmt);
await db.exec(before.get("profiles_locked_update_columns").stmt);

// 20261102082018's revoke, as on prod.
await db.exec(`REVOKE UPDATE (phone) ON public.profiles FROM anon, authenticated;`);

if (!MODE) {
  let sql = readFileSync(DIR + THIS, "utf8");
  if (PLANT === "no-sync") sql = sql.replace(/PERFORM public\.sync_profiles_update_grants\(\);/, "NULL;");
  if (PLANT === "no-phone") sql = sql.replace(/'promotions_before_unsubscribe',[\s\S]*?'phone'\n/, "'promotions_before_unsubscribe'\n");
  if (PLANT === "no-sync") {
    // Put the grant back the way the old cron did, then apply the planted migration.
    await db.exec(`GRANT UPDATE (phone) ON public.profiles TO authenticated;`);
  }
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("migration applies 3x (replay-safe)", true);
}

const priv = async (col) =>
  (await db.query(`SELECT has_column_privilege('authenticated', 'public.profiles', '${col}', 'UPDATE') AS p`)).rows[0].p;

if (PLANT !== "no-sync") {
  check("right after the migration, authenticated has no UPDATE (phone)", (await priv("phone")) === false);
} else {
  check("the migration itself takes UPDATE (phone) away (no cron needed)", (await priv("phone")) === false);
}

// The cron tick.
const tick = (await db.query(`SELECT public.sync_profiles_update_grants() AS r`)).rows[0].r;
check("after the sync cron tick, authenticated STILL has no UPDATE (phone)", (await priv("phone")) === false, JSON.stringify(tick));
check("...and keeps UPDATE on its ordinary columns (bio, full_name)", (await priv("bio")) === true && (await priv("full_name")) === true);
check("...and no UPDATE on the other locked columns (ban_status)", (await priv("ban_status")) === false);
const locked = (await db.query(`SELECT 'phone' = ANY (public.profiles_locked_update_columns()) AS l`)).rows[0].l;
check("phone is in profiles_locked_update_columns()", locked === true);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);

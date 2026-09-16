#!/usr/bin/env node
/**
 * PGlite proof for 20260916023649_revoke_trigger_fn_execute_and_pin_search_path.
 *
 *   node scripts/probes/trigger-fn-grants.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md):
 *   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
 *
 * Proves, on a prod-shaped stub:
 *   1. RED-BEFORE: a trigger-returning function created with the PUBLIC default
 *      is EXECUTE-able by anon/authenticated; normalize_phone_for_ban(text) has
 *      no pinned search_path.
 *   2. AFTER the migration: anon/authenticated can no longer EXECUTE the trigger
 *      function, and normalize_phone_for_ban has search_path=public.
 *   3. IDEMPOTENT: applying the migration a 2nd and 3rd time is a no-op, no error.
 *   4. REPLAY-SAFE: applying it to a DB that has NONE of the named functions is a
 *      clean no-op (the to_regprocedure guards skip every statement).
 */
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import { readFileSync } from "node:fs";

const MIGRATION = readFileSync(
  new URL("../../supabase/migrations/20260916023649_revoke_trigger_fn_execute_and_pin_search_path.sql", import.meta.url).pathname,
  "utf8",
);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ROLES = `
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  END $$;`;

// One of the eight trigger functions, created the way prod did: SECURITY
// DEFINER, returns trigger, with the implicit PUBLIC EXECUTE default. Plus the
// invoker helper with an unpinned search_path.
const STUB = `
  CREATE OR REPLACE FUNCTION public.audit_money_table_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $fn$ BEGIN RETURN NEW; END $fn$;
  CREATE OR REPLACE FUNCTION public.normalize_phone_for_ban(p_phone text) RETURNS text
    LANGUAGE sql AS $fn$ SELECT regexp_replace(p_phone, '\\D', '', 'g') $fn$;`;

const anonExec = async (db, fn) =>
  (await db.query(`SELECT has_function_privilege('anon', '${fn}', 'EXECUTE') AS x`)).rows[0].x;
const authExec = async (db, fn) =>
  (await db.query(`SELECT has_function_privilege('authenticated', '${fn}', 'EXECUTE') AS x`)).rows[0].x;
const searchPath = async (db) =>
  (await db.query(`SELECT array_to_string(p.proconfig,',') AS c FROM pg_proc p
                   WHERE p.oid='public.normalize_phone_for_ban(text)'::regprocedure`)).rows[0]?.c ?? null;

// ── Scenario A: functions present (the real prod shape) ─────────────────────
{
  const db = new PGlite();
  await db.exec(ROLES);
  await db.exec(STUB);

  check("RED-BEFORE anon can EXECUTE trigger fn", await anonExec(db, "public.audit_money_table_change()") === true);
  check("RED-BEFORE authenticated can EXECUTE trigger fn", await authExec(db, "public.audit_money_table_change()") === true);
  check("RED-BEFORE normalize_phone_for_ban search_path unpinned", (await searchPath(db)) === null);

  await db.exec(MIGRATION);

  check("AFTER anon cannot EXECUTE trigger fn", await anonExec(db, "public.audit_money_table_change()") === false);
  check("AFTER authenticated cannot EXECUTE trigger fn", await authExec(db, "public.audit_money_table_change()") === false);
  check("AFTER normalize_phone_for_ban search_path=public", (await searchPath(db)) === "search_path=public");

  // Idempotent: 2nd + 3rd apply must not error and must keep the end state.
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  check("IDEMPOTENT anon still cannot EXECUTE after 3x", await anonExec(db, "public.audit_money_table_change()") === false);
  check("IDEMPOTENT search_path still pinned after 3x", (await searchPath(db)) === "search_path=public");
  await db.close();
}

// ── Scenario B: none of the named functions exist (from-scratch replay) ─────
{
  const db = new PGlite();
  await db.exec(ROLES);
  let threw = null;
  try { await db.exec(MIGRATION); await db.exec(MIGRATION); } catch (e) { threw = e.message; }
  check("REPLAY-SAFE clean no-op when functions absent", threw === null, threw ?? "");
  await db.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);

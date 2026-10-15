#!/usr/bin/env node
/**
 * PGlite proof for 20261015023908_jobs_helper_fee_flat_cents (roadmap F3,
 * jobs flat fee): the fee-model stamp is server-only.
 *
 *   node src/test/pglite/jobsFeeModelLock.pglite.mjs                  # before (RED) + after, 3x apply
 *   NEW_MIGRATION=skip node src/test/pglite/jobsFeeModelLock.pglite.mjs  # before only
 *
 * pglite is not a dependency (CLAUDE.md); it is read from PGLITE_DIR
 * (default ~/.lh-pglite).
 *
 * Shape: a minimal public.jobs (the columns this lock reads) and the LIVE
 * public.is_server_context() body (pg_get_functiondef on prod, 2026-10-15),
 * with auth.uid()/auth.role() reading request.jwt.claims like Supabase.
 * Roles are real: `authenticated` + a JWT sub is PostgREST with a user token.
 *
 * RED-BEFORE (without the lock, a column with no lock):
 *   R1  a poster INSERTs a job with helper_fee_flat_cents = 0 and it sticks.
 *   R2  a poster PATCHes a funded legacy job (stamp NULL) onto the flat model.
 * AFTER:
 *   A1  the poster's INSERT has the stamp cleared to NULL.
 *   A2  the poster's UPDATE of the stamp is refused with 42501.
 *   A3  the poster's UPDATE of another column still lands.
 *   A4  the server (service role, no JWT) stamps 70 and it lands.
 *   A5  the range check refuses a negative stamp even from the server.
 *   A6  the migration applies three times (replay-safe).
 */
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import { readFileSync } from "node:fs";

const ROOT = new URL("../../../", import.meta.url).pathname;
const MIGRATION = readFileSync(
  process.env.NEW_MIGRATION_FILE ?? `${ROOT}supabase/migrations/20261015023908_jobs_helper_fee_flat_cents.sql`,
  "utf8",
);
const MODE = process.env.NEW_MIGRATION ?? "";

const POSTER = "11111111-1111-1111-1111-111111111111";

async function fresh() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'sub','')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'role' $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    -- LIVE body, prod 2026-10-15.
    CREATE OR REPLACE FUNCTION public.is_server_context()
     RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
    AS $function$
      SELECT auth.uid() IS NULL
         AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
         AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
    $function$;
    CREATE TABLE public.jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id uuid,
      title text,
      budget numeric,
      payment_status text DEFAULT 'unpaid',
      helper_fee_percent numeric
    );
    GRANT ALL ON public.jobs TO authenticated, service_role;
  `);
  return db;
}

async function asPoster(db, sql) {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${POSTER}","role":"authenticated"}', false);`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claims', '', false);`);
  }
}
async function asServer(db, sql) {
  await db.exec(`SET ROLE service_role; SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claims', '', false);`);
  }
}
const errCode = async (p) => {
  try { await p; return "ok"; } catch (e) { return e.code ?? String(e.message); }
};

let failures = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures++;
};

// ── BEFORE: the column with no lock (what ADD COLUMN alone would leave). ──
{
  const db = await fresh();
  await db.exec(`ALTER TABLE public.jobs ADD COLUMN helper_fee_flat_cents integer;`);
  await asPoster(db, `INSERT INTO public.jobs (id, customer_id, title, budget, helper_fee_flat_cents)
                      VALUES ('00000000-0000-0000-0000-0000000000a1', '${POSTER}', 'r1', 100, 0)`);
  const r1 = (await db.query(`SELECT helper_fee_flat_cents v FROM public.jobs WHERE title='r1'`)).rows[0].v;
  check("R1 (before) a poster's INSERT keeps its own fee stamp", r1 === 0, `stamp=${r1}`);
  await db.exec(`INSERT INTO public.jobs (id, customer_id, title, budget, payment_status, helper_fee_percent)
                 VALUES ('00000000-0000-0000-0000-0000000000a2', '${POSTER}', 'r2', 100, 'escrow', 12)`);
  const r2 = await errCode(asPoster(db, `UPDATE public.jobs SET helper_fee_flat_cents = 70 WHERE title='r2'`));
  check("R2 (before) a poster flips a funded legacy job onto the flat model", r2 === "ok", r2);
  await db.close();
}

if (MODE !== "skip") {
  const db = await fresh();
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
  check("A6 the migration applies three times", true);

  await asPoster(db, `INSERT INTO public.jobs (id, customer_id, title, budget, helper_fee_flat_cents)
                      VALUES ('00000000-0000-0000-0000-0000000000b1', '${POSTER}', 'a1', 100, 0)`);
  const a1 = (await db.query(`SELECT helper_fee_flat_cents v FROM public.jobs WHERE title='a1'`)).rows[0].v;
  check("A1 a poster's INSERT has the stamp cleared", a1 === null, `stamp=${a1}`);

  await db.exec(`INSERT INTO public.jobs (id, customer_id, title, budget, payment_status, helper_fee_percent)
                 VALUES ('00000000-0000-0000-0000-0000000000b2', '${POSTER}', 'a2', 100, 'escrow', 12)`);
  const a2 = await errCode(asPoster(db, `UPDATE public.jobs SET helper_fee_flat_cents = 70 WHERE title='a2'`));
  check("A2 a poster's UPDATE of the stamp is refused 42501", a2 === "42501", a2);
  const a2v = (await db.query(`SELECT helper_fee_flat_cents v FROM public.jobs WHERE title='a2'`)).rows[0].v;
  check("A2 the legacy job stays legacy", a2v === null, `stamp=${a2v}`);

  const a3 = await errCode(asPoster(db, `UPDATE public.jobs SET title = 'a2-renamed' WHERE title='a2'`));
  check("A3 a poster's other UPDATE still lands", a3 === "ok", a3);

  const a4 = await errCode(asServer(db, `UPDATE public.jobs SET helper_fee_flat_cents = 70, helper_fee_percent = 5 WHERE title='a1'`));
  const a4v = (await db.query(`SELECT helper_fee_flat_cents v FROM public.jobs WHERE title='a1'`)).rows[0].v;
  check("A4 the server stamps the flat model", a4 === "ok" && a4v === 70, `${a4} stamp=${a4v}`);

  const a5 = await errCode(asServer(db, `UPDATE public.jobs SET helper_fee_flat_cents = -1 WHERE title='a1'`));
  check("A5 the range check refuses a negative stamp", a5 === "23514", a5);
  await db.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);

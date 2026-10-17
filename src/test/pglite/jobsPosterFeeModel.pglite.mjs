#!/usr/bin/env node
/**
 * PGlite proof for 20261017230824_jobs_poster_fee_model (owner 2026-10-18:
 * the poster pays 5% + 70c, the Helpr keeps 100%): the poster-fee stamp is
 * server-only, and the poster and Helpr stamps can never both charge (or both
 * waive) a fee.
 *
 *   node src/test/pglite/jobsPosterFeeModel.pglite.mjs                  # before (RED) + after, 3x apply
 *   NEW_MIGRATION=skip node src/test/pglite/jobsPosterFeeModel.pglite.mjs  # before only
 *
 * pglite is not a dependency (CLAUDE.md); it is read from PGLITE_DIR
 * (default ~/.lh-pglite).
 *
 * Shape: a minimal public.jobs, the LIVE public.is_server_context() body,
 * and the F3 migration (20261015023908) applied first, as on prod.
 *
 * RED-BEFORE (the column added with no lock and no CHECK):
 *   R1  a poster INSERTs a job with poster_fee_flat_cents set and it sticks.
 *   R2  a row can say the poster paid the fee AND the Helpr pays 5% + 70c.
 *   R3  a row can carry a 0/0 Helpr stamp with no poster fee (nobody pays).
 * AFTER:
 *   A1  the poster's INSERT has both stamps cleared to NULL.
 *   A2  the poster's UPDATE of the poster stamp is refused with 42501.
 *   A3  the server stamps the poster model (70, Helpr 0/0) and it lands.
 *   A4  the poster model with a Helpr fee still stamped is refused (23514).
 *   A5  a 0/0 Helpr stamp with no poster stamp is refused (23514).
 *   A6  a legacy job and an F3 job are untouched and still writable.
 *   A7  the F3 lock still holds (poster UPDATE of helper_fee_flat_cents 42501).
 *   A8  the range check refuses a negative stamp even from the server.
 *   A9  the migration applies three times (replay-safe).
 *   A10 a 0c Helpr flat stamp without the poster stamp is refused (23514),
 *       whatever the percent (lh-money-escrow review of 57267947a, #1).
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
const F3 = readFileSync(`${ROOT}supabase/migrations/20261015023908_jobs_helper_fee_flat_cents.sql`, "utf8");
const MIGRATION = readFileSync(
  process.env.NEW_MIGRATION_FILE ?? `${ROOT}supabase/migrations/20261017230824_jobs_poster_fee_model.sql`,
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
  await db.exec(F3);
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
const stamp = async (db, title) =>
  (await db.query(`SELECT poster_fee_flat_cents p, helper_fee_flat_cents h, helper_fee_percent::float8 pct FROM public.jobs WHERE title='${title}'`)).rows[0];
const LEGACY = `INSERT INTO public.jobs (customer_id, title, budget, payment_status, helper_fee_percent)
                VALUES ('${POSTER}', 'legacy', 100, 'escrow', 12)`;
const F3_ROW = `INSERT INTO public.jobs (customer_id, title, budget, payment_status, helper_fee_percent, helper_fee_flat_cents)
                VALUES ('${POSTER}', 'f3', 100, 'escrow', 5, 70)`;

// ── BEFORE: the column with no lock and no CHECK (what ADD COLUMN alone would leave). ──
{
  const db = await fresh();
  await db.exec(`ALTER TABLE public.jobs ADD COLUMN poster_fee_flat_cents integer;`);
  await asPoster(db, `INSERT INTO public.jobs (customer_id, title, budget, poster_fee_flat_cents)
                      VALUES ('${POSTER}', 'r1', 100, 0)`);
  check("R1 (before) a poster's INSERT keeps its own poster-fee stamp", (await stamp(db, "r1")).p === 0);
  const r2 = await errCode(asServer(db, `INSERT INTO public.jobs (customer_id, title, budget, poster_fee_flat_cents, helper_fee_flat_cents, helper_fee_percent)
                                          VALUES ('${POSTER}', 'r2', 100, 70, 70, 5)`));
  check("R2 (before) a row charges the poster AND the Helpr", r2 === "ok", r2);
  const r3 = await errCode(asServer(db, `INSERT INTO public.jobs (customer_id, title, budget, helper_fee_flat_cents, helper_fee_percent)
                                          VALUES ('${POSTER}', 'r3', 100, 0, 0)`));
  check("R3 (before) a row charges nobody (0/0 Helpr stamp, no poster fee)", r3 === "ok", r3);
  await db.close();
}

if (MODE !== "skip") {
  const db = await fresh();
  await db.exec(LEGACY);
  await db.exec(F3_ROW);
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
  check("A9 the migration applies three times over a legacy and an F3 row", true);

  await asPoster(db, `INSERT INTO public.jobs (customer_id, title, budget, poster_fee_flat_cents, helper_fee_flat_cents)
                      VALUES ('${POSTER}', 'a1', 100, 70, 70)`);
  const a1 = await stamp(db, "a1");
  check("A1 a poster's INSERT has both stamps cleared", a1.p === null && a1.h === null, JSON.stringify(a1));

  const a2 = await errCode(asPoster(db, `UPDATE public.jobs SET poster_fee_flat_cents = 70 WHERE title='a1'`));
  check("A2 a poster's UPDATE of the poster stamp is refused 42501", a2 === "42501", a2);

  const a3 = await errCode(asServer(db, `UPDATE public.jobs SET poster_fee_flat_cents = 70, helper_fee_flat_cents = 0, helper_fee_percent = 0 WHERE title='a1'`));
  const a3v = await stamp(db, "a1");
  check("A3 the server stamps the poster model with the Helpr at 0/0", a3 === "ok" && a3v.p === 70 && a3v.h === 0 && a3v.pct === 0, `${a3} ${JSON.stringify(a3v)}`);

  const a4 = await errCode(asServer(db, `UPDATE public.jobs SET poster_fee_flat_cents = 70 WHERE title='f3'`));
  check("A4 the poster model on a job whose Helpr still pays is refused 23514", a4 === "23514", a4);

  const a5 = await errCode(asServer(db, `UPDATE public.jobs SET helper_fee_flat_cents = 0, helper_fee_percent = 0 WHERE title='f3'`));
  check("A5 a 0/0 Helpr stamp with no poster fee is refused 23514", a5 === "23514", a5);
  const a5p = await errCode(asServer(db, `UPDATE public.jobs SET poster_fee_flat_cents = NULL WHERE title='a1'`));
  check("A5 removing the poster stamp from a 0/0 job is refused 23514", a5p === "23514", a5p);

  const a10 = await errCode(asServer(db, `UPDATE public.jobs SET helper_fee_flat_cents = 0 WHERE title='f3'`));
  check("A10 a 0c flat stamp with the percent left at 5 and no poster stamp is refused 23514", a10 === "23514", a10);
  const a10n = await errCode(asServer(db, `INSERT INTO public.jobs (customer_id, title, budget, helper_fee_flat_cents)
                                            VALUES ('${POSTER}', 'a10n', 100, 0)`));
  check("A10 a 0c flat stamp with a NULL percent and no poster stamp is refused 23514", a10n === "23514", a10n);
  const a10p = await errCode(asServer(db, `INSERT INTO public.jobs (customer_id, title, budget, poster_fee_flat_cents, helper_fee_flat_cents)
                                            VALUES ('${POSTER}', 'a10p', 100, 70, 0)`));
  check("A10 a poster stamp whose Helpr percent is NULL (not 0) is refused 23514", a10p === "23514", a10p);

  const leg = await stamp(db, "legacy");
  const f3 = await stamp(db, "f3");
  check("A6 the legacy and F3 rows keep their stamps", leg.p === null && leg.h === null && leg.pct === 12 && f3.p === null && f3.h === 70 && f3.pct === 5,
    JSON.stringify({ leg, f3 }));
  const a6 = await errCode(asPoster(db, `UPDATE public.jobs SET title = 'legacy2' WHERE title='legacy'`));
  check("A6 a poster's other UPDATE still lands", a6 === "ok", a6);

  const a7 = await errCode(asPoster(db, `UPDATE public.jobs SET helper_fee_flat_cents = 0 WHERE title='f3'`));
  check("A7 the F3 lock still holds 42501", a7 === "42501", a7);

  const a8 = await errCode(asServer(db, `UPDATE public.jobs SET poster_fee_flat_cents = -1 WHERE title='a1'`));
  check("A8 the range check refuses a negative stamp", a8 === "23514", a8);
  await db.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);

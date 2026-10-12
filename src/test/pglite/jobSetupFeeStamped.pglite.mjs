#!/usr/bin/env node
/**
 * PGlite proof for 20261012171259_job_setup_fee_stamped (docs/OPEN.md Q1346,
 * owner decision 2026-10-12).
 *
 *   node src/test/pglite/jobSetupFeeStamped.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/jobSetupFeeStamped.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * jobs is a stand-in with prod's grant shape for this question: authenticated
 * holds table-level INSERT/UPDATE (live relacl authenticated=awdxm, measured
 * 2026-10-12), so a new column is client-writable unless its trigger stops it.
 * Proven: a client INSERT that sends the fee gets NULL; a client UPDATE of it
 * is refused (42501); a client UPDATE of another column passes; the service
 * role (stripe-webhook) can stamp it.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const NEW = read("../../../supabase/migrations/20261012171259_job_setup_fee_stamped.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, title text, budget numeric);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.jobs TO authenticated;
GRANT ALL ON public.jobs TO service_role;
`);
if (MODE !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(NEW);
  check("migration applies 3x (replay-safe)", true);
}

const POSTER = "11111111-1111-4111-8111-111111111111";
async function as(role, sql) {
  try {
    await db.exec(`SET ROLE ${role};`);
    const r = await db.query(sql);
    return { rows: r.rows };
  } catch (e) {
    return { error: e.message, code: e.code };
  } finally {
    await db.exec("RESET ROLE;");
  }
}

const ins = await as("authenticated", `INSERT INTO public.jobs (customer_id, title, budget, onboarding_fee_amount) VALUES ('${POSTER}', 'First job', 100, 50) RETURNING id, onboarding_fee_amount`);
check("a client INSERT that sends the fee stores NULL", !ins.error && ins.rows[0].onboarding_fee_amount === null, JSON.stringify(ins));
const id = ins.rows?.[0]?.id;

const upd = await as("authenticated", `UPDATE public.jobs SET onboarding_fee_amount = 2 WHERE id = '${id}'`);
check("a client UPDATE of the fee is refused (42501)", upd.code === "42501", JSON.stringify(upd));

const other = await as("authenticated", `UPDATE public.jobs SET title = 'Renamed' WHERE id = '${id}' RETURNING title`);
check("a client UPDATE of another column still works", !other.error && other.rows[0]?.title === "Renamed", JSON.stringify(other));

const stamp = await as("service_role", `UPDATE public.jobs SET onboarding_fee_amount = 2 WHERE id = '${id}' RETURNING onboarding_fee_amount`);
check("the service role (stripe-webhook) stamps it", !stamp.error && Number(stamp.rows[0]?.onboarding_fee_amount) === 2, JSON.stringify(stamp));

const keep = await as("authenticated", `UPDATE public.jobs SET title = 'Again' WHERE id = '${id}' RETURNING onboarding_fee_amount`);
check("a later client UPDATE leaves the stamp alone", !keep.error && Number(keep.rows[0]?.onboarding_fee_amount) === 2, JSON.stringify(keep));

console.log(failures ? `\n${failures} FAIL(s)` : "\nall PASS");
process.exit(failures ? 1 : 0);

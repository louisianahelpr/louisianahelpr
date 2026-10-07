#!/usr/bin/env node
/**
 * PGlite proof for 20261007035201_jobs_payment_intent_unique (docs/OPEN.md Q1355 (4)).
 *
 *   node src/test/pglite/jobsPaymentIntentUnique.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/jobsPaymentIntentUnique.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = readFileSync(new URL("../../../supabase/migrations/20261007035201_jobs_payment_intent_unique.sql", import.meta.url).pathname, "utf8");
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running against the state on main (expect FAILs)");

const db = new PGlite();
await db.exec(`CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_payment_intent_id text);`);
if (!skip) for (let i = 0; i < 3; i++) await db.exec(MIG);

let fails = 0;
const check = (n, ok, d = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`);
  if (!ok) fails++;
};
await db.exec(`INSERT INTO public.jobs (stripe_payment_intent_id) VALUES (NULL), (NULL), ('pi_a');`);
check("many jobs with no PaymentIntent are allowed", true);
let err = null;
try { await db.exec(`INSERT INTO public.jobs (stripe_payment_intent_id) VALUES ('pi_a');`); } catch (e) { err = e.message; }
check("a second job with the same PaymentIntent is refused", !!err && /unique/i.test(err), err ?? "landed");
err = null;
try {
  await db.exec(`UPDATE public.jobs SET stripe_payment_intent_id = 'pi_a' WHERE id = (SELECT id FROM public.jobs WHERE stripe_payment_intent_id IS NULL LIMIT 1);`);
} catch (e) { err = e.message; }
check("stamping another job with it is refused", !!err && /unique/i.test(err), err ?? "landed");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);

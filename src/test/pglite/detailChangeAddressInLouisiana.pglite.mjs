#!/usr/bin/env node
/**
 * PGlite proof for 20261021111244_detail_change_address_in_louisiana.sql (Q2291 follow-up, review L2).
 *
 *   node src/test/pglite/detailChangeAddressInLouisiana.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/detailChangeAddressInLouisiana.pglite.mjs # RED: without it
 *
 * An out-of-state address is refused when a detail change is ASKED (not only when a Helpr accepts it).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const FIX = readFileSync(new URL("../../../supabase/migrations/20261021111244_detail_change_address_in_louisiana.sql", import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: no request-time rule (expect FAILs)`);

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE TABLE public.jobs (id int PRIMARY KEY, is_seed boolean DEFAULT false);
  INSERT INTO public.jobs VALUES (1, false), (2, true);
  CREATE TABLE public.job_detail_change_requests (id serial PRIMARY KEY, job_id int, changed_fields text[],
    new_title text, new_location text, new_latitude numeric, new_longitude numeric);
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(FIX);

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got ${JSON.stringify(got)}`}`); };
const ask = async (job, fields, loc, lat = "NULL", lng = "NULL") => {
  try {
    await db.query(`INSERT INTO public.job_detail_change_requests (job_id, changed_fields, new_location, new_latitude, new_longitude)
      VALUES (${job}, ARRAY[${fields.map((f) => `'${f}'`).join(",")}]::text[], ${loc === null ? "NULL" : `'${loc}'`}, ${lat}, ${lng})`);
    return { ok: true };
  } catch (e) { return { ok: false, err: String(e.message) }; }
};
const refused = (r) => !r.ok && /job_address_not_louisiana/.test(r.err);
check("R1: a Texas address asked for is refused", refused(await ask(1, ["location"], "700 Main St, Houston, TX 77002")));
check("R2: a non-LA ZIP asked for is refused", refused(await ask(1, ["location"], "12 Oak St, Houston, LA 77002")));
check("R3: a point outside Louisiana asked for is refused", refused(await ask(1, ["location"], "12 Oak St", "29.76", "-95.37")));
check("A1: a Louisiana address is accepted", (await ask(1, ["location"], "1412 Bayou Ridge Rd, Lafayette, LA 70508", "30.22", "-92.02")).ok);
check("A2: a change that is not the address is untouched", (await ask(1, ["title"], null)).ok);
check("A3: a test job passes", (await ask(2, ["location"], "100 Audit Way, Baton Rouge, LA 99999")).ok);
console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);

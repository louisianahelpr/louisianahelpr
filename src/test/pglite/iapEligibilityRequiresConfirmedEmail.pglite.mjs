#!/usr/bin/env node
/**
 * PGlite proof for 20261005065813_iap_eligibility_requires_confirmed_email (Q1200).
 *
 *   node src/test/pglite/iapEligibilityRequiresConfirmedEmail.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/iapEligibilityRequiresConfirmedEmail.pglite.mjs # RED: the live body
 *
 * The two functions run VERBATIM from their newest migrations:
 * session_email_unconfirmed (20260927234313) and subscription_purchase_eligibility
 * (20260905204037 = live, md5 eeaf8d13…). auth.uid()/auth.role() read the
 * request settings PostgREST sets from the JWT; auth.users carries only id and
 * email_confirmed_at; profiles only the columns the function reads.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(`../../../supabase/migrations/${rel}`, import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE body (expect FAILs)`);

function cut(file, name) {
  const sql = read(file);
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const close = sql.indexOf(open[1], m.index + open.index + open[0].length);
  return sql.slice(m.index, close + open[1].length) + ";";
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const CONFIRMED = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const UNCONFIRMED = "00000000-0000-4000-8000-0000000000aa";
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email_confirmed_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, subscription_tier text, subscription_source text,
  subscription_expires_at timestamptz, stripe_subscription_id text, apple_original_transaction_id text);
INSERT INTO auth.users VALUES ('${CONFIRMED}', now() - interval '30 days'), ('${UNCONFIRMED}', NULL);
INSERT INTO public.profiles (user_id, subscription_tier) VALUES ('${CONFIRMED}', 'free'), ('${UNCONFIRMED}', 'free');
`);
await db.exec(cut("20260927234313_refuse_unconfirmed_email_writes.sql", "session_email_unconfirmed"));
await db.exec(cut("20260905204037_apple_iap_entitlement_source_and_purchase_guard.sql", "subscription_purchase_eligibility"));
await db.exec(`REVOKE ALL ON FUNCTION public.subscription_purchase_eligibility(text) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.subscription_purchase_eligibility(text) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.session_email_unconfirmed() TO authenticated;`);
if (MODE !== "skip") {
  const NEW = read("20261005065813_iap_eligibility_requires_confirmed_email.sql");
  for (let i = 0; i < 3; i++) await db.exec(NEW);
}

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who ?? ""}', false), set_config('request.role', '${who ? "authenticated" : "anon"}', false);`);
  await db.exec(who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const ask = (who, platform) => as(who, `SELECT public.subscription_purchase_eligibility('${platform}') AS v`);

for (const platform of ["apple", "stripe"]) {
  const u = await ask(UNCONFIRMED, platform);
  check(`R1 an unconfirmed session may not buy (${platform})`, u.ok && u.rows[0].v.allowed === false && u.rows[0].v.code === "email_unconfirmed" && /Confirm your email/.test(u.rows[0].v.reason), u.ok ? JSON.stringify(u.rows[0].v) : u.err);
  const c = await ask(CONFIRMED, platform);
  check(`L1 a confirmed session still may (${platform})`, c.ok && c.rows[0].v.allowed === true, c.ok ? JSON.stringify(c.rows[0].v) : c.err);
}
const anon = await ask(null, "apple");
check("L2 anon still cannot ask", !anon.ok, anon.ok ? JSON.stringify(anon.rows) : anon.err);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);

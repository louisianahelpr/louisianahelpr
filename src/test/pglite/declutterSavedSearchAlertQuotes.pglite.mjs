#!/usr/bin/env node
/**
 * PGlite proof for 20261030153722_declutter_saved_search_alert_quotes (D4-15): the saved-search alert never wraps a name
 * that already has its own quotes or "in Declutter" in a second pair of double quotes, in the bell or the email.
 *
 *   node src/test/pglite/declutterSavedSearchAlertQuotes.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSavedSearchAlertQuotes.pglite.mjs # RED: the previous body
 *   MUTANT=<name> node src/test/pglite/declutterSavedSearchAlertQuotes.pglite.mjs      # a planted defect: must FAIL
 *
 * Stubbed, said so: declutter_notify records the bell row; net.http_post records the email body; the search match,
 * miles, feature and seller-hidden helpers answer yes/no. The alert function itself is the real body.
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261030153722_declutter_saved_search_alert_quotes.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // Curly quotes are not noticed any more: "“mug”" gets wrapped again.
  noQuoteCheck: [`r.search_name ~ '["“”]' OR `, ""],
  // The "in Declutter" suffix is not noticed any more.
  noSuffixCheck: [` OR r.search_name ~ ' in Declutter$'`, ""],
  // A name of the member's own loses its quotes.
  neverQuote: [`ELSE '"' || r.search_name || '"' END`, `ELSE r.search_name END`],
};
const skip = process.env.NEW_MIGRATION === "skip";

function definitionBefore(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = rest.slice(0, end + tag[1].length) + ";";
    }
  }
  if (!last) throw new Error(`no definition of ${name} before ${before}`);
  return last;
}

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `88888888-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), CURLY = U(2), CATEGORY = U(3), OWN = U(4), STRAIGHT = U(5);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA net; CREATE SCHEMA vault;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE net.calls (body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls VALUES (body); SELECT 1::bigint $$;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url','http://x'),('service_role_key','k');
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.miles_between(a numeric, b numeric, c numeric, d numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT 1::numeric $$;
CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_user_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.declutter_seller_hidden(p_seller uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_search_matches(q text, t text, d text, c text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, email_verified boolean DEFAULT true, ban_status text DEFAULT 'active',
  latitude numeric, longitude numeric, is_seed boolean DEFAULT false);
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, job_matches boolean, saved_searches_paused boolean DEFAULT false);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.bell (user_id uuid, title text, message text, link text);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_message text, p_link text, p_other uuid) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.bell VALUES (p_user, p_title, p_message, p_link) $$;
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid NOT NULL, title text NOT NULL,
  description text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'kitchen', status text NOT NULL DEFAULT 'live',
  current_price_cents integer NOT NULL, area_lat numeric NOT NULL DEFAULT 30.0, area_lng numeric NOT NULL DEFAULT -92.0,
  is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.saved_searches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL,
  section text NOT NULL DEFAULT 'declutter', created_at timestamptz NOT NULL DEFAULT now(), notify_enabled boolean NOT NULL DEFAULT true,
  notify_email boolean NOT NULL DEFAULT true, category text, max_budget numeric, min_budget numeric, query text,
  radius_miles numeric, last_notified_at timestamptz, last_emailed_at timestamptz);
`);

await db.exec(definitionBefore("deliver_saved_search_item_alerts", THIS));
if (!skip) {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  if (MUTANT) {
    const m = MUTANTS[MUTANT];
    if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
    mig = mig.replace(m[0], m[1]);
  }
  for (let k = 1; k <= 3; k++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${k})`); } catch (e) { check(false, `the migration applies (run ${k}): ${e.message}`); }
  }
}

const q = async (s, p = []) => (await db.query(s, p)).rows;
for (const u of [SELLER, CURLY, CATEGORY, OWN, STRAIGHT]) await q(`INSERT INTO public.profiles (user_id) VALUES ($1)`, [u]);
for (const [u, name] of [[CURLY, "“mug” in Declutter"], [CATEGORY, "Kitchen in Declutter"], [OWN, "Mom's kitchen"], [STRAIGHT, 'the "good" mugs']]) {
  await q(`INSERT INTO public.saved_searches (user_id, name) VALUES ($1, $2)`, [u, name]);
}
const item = (await q(`INSERT INTO public.declutter_items (seller_id, title, current_price_cents) VALUES ($1, 'Blue mug', 500) RETURNING id`, [SELLER]))[0].id;
const sent = (await q(`SELECT public.deliver_saved_search_item_alerts($1) AS n`, [item]))[0].n;
check(sent === 4, `four members alerted (${sent})`);

const bell = async (u) => (await q(`SELECT message FROM public.bell WHERE user_id = $1`, [u]))[0]?.message;
const mail = async (u) => (await q(`SELECT body->>'message' AS m FROM net.calls WHERE body->>'user_id' = $1`, [u]))[0]?.m;
for (const [u, want, what] of [
  [CURLY, "Something new matches “mug” in Declutter: Blue mug ($5)", "the default name with its own quotes"],
  [CATEGORY, "Something new matches Kitchen in Declutter: Blue mug ($5)", "the default category name"],
  [OWN, `Something new matches "Mom's kitchen": Blue mug ($5)`, "a name of the member's own keeps its quotes"],
  [STRAIGHT, 'Something new matches the "good" mugs: Blue mug ($5)', "a name holding straight quotes gets no second pair"],
]) {
  const b = await bell(u), m = await mail(u);
  check(b === want, `${what}: bell (${b})`);
  check(m === want, `${what}: email (${m})`);
}
const acl = (await q(`SELECT has_function_privilege('anon', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') a,
  has_function_privilege('authenticated', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') u,
  has_function_privilege('service_role', 'public.deliver_saved_search_item_alerts(uuid)', 'EXECUTE') s`))[0];
if (!skip) check(!acl.a && !acl.u && acl.s, `grants: anon ${acl.a}, authenticated ${acl.u}, service_role ${acl.s}`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);

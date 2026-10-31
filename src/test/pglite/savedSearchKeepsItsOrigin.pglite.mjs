#!/usr/bin/env node
/**
 * PGlite proof for 20261031023451_saved_search_keeps_its_origin (BUY-49), on deliver_saved_search_item_alerts.
 * saved_search_new_counts' change is the same test; it is held by src/test/savedSearchKeepsItsOrigin.test.ts, not run here.
 *
 *   npx tsx src/test/pglite/savedSearchKeepsItsOrigin.pglite.mjs            # AFTER: applied 3x, every check PASS
 *   npx tsx src/test/pglite/savedSearchKeepsItsOrigin.pglite.mjs --before   # RED: the old body over the new columns, O1, O3, O4 FAIL
 *
 *   O1 no profile location, saved near the item: alerted (it never fired)
 *   O2 no profile location, no saved origin: no alert, as before
 *   O3 profile far, saved near: alerted; O4 profile near, saved far: not alerted (the saved origin wins)
 *   O5 an older search with no origin still measures from the profile
 *   O6 no radius: alerted whatever the location
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261031023451_saved_search_keeps_its_origin.sql";
const BEFORE = process.argv.includes("--before") || process.env.NEW_MIGRATION === "skip";
const d = effectiveDefs(DIR, { before: THIS }).get("deliver_saved_search_item_alerts");
const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
const oldBody = `${d.stmt.slice(0, d.stmt.indexOf(open[1], open.index + open[0].length) + open[1].length)};`;

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SELLER = U(1);
const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA net; CREATE SCHEMA vault; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'select null::uuid';
CREATE TABLE net.calls (body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls VALUES (body) RETURNING 1::bigint $$;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
-- One degree of latitude is 69 miles; these fixtures differ only in latitude.
CREATE FUNCTION public.miles_between(a numeric, b numeric, c numeric, d numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT abs(a - c) * 69 $$;
CREATE FUNCTION public.feature_enabled_for_user(p_key text, p_user_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.declutter_seller_hidden(p_seller uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_search_matches(q text, t text, d text, c text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, email_verified boolean DEFAULT true, ban_status text DEFAULT 'active', latitude numeric, longitude numeric, is_seed boolean DEFAULT false);
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, job_matches boolean, saved_searches_paused boolean DEFAULT false);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.bell (user_id uuid);
CREATE FUNCTION public.declutter_notify(p_user uuid, p_kind text, p_title text, p_message text, p_link text, p_other uuid) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.bell VALUES (p_user) $$;
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid NOT NULL, title text NOT NULL, description text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'kitchen', status text NOT NULL DEFAULT 'live', current_price_cents integer NOT NULL, area_lat numeric NOT NULL DEFAULT 30.0, area_lng numeric NOT NULL DEFAULT -92.0, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.saved_searches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL, section text NOT NULL DEFAULT 'declutter', created_at timestamptz NOT NULL DEFAULT now(), notify_enabled boolean NOT NULL DEFAULT true, notify_email boolean NOT NULL DEFAULT false, category text, max_budget numeric, min_budget numeric, query text, radius_miles numeric, last_notified_at timestamptz, last_emailed_at timestamptz);
ALTER TABLE public.saved_searches ADD COLUMN origin_lat numeric, ADD COLUMN origin_lng numeric;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
${oldBody}
`);
if (!BEFORE) {
  const sql = readFileSync(DIR + THIS, "utf8");
  // saved_search_new_counts needs tables this proof does not build, and is not called here: bodies are not checked at create.
  await db.exec("SET check_function_bodies = off;");
  await db.exec(`CREATE TABLE IF NOT EXISTS public.jobs (id uuid); `);
  for (let i = 0; i < 3; i++) await db.exec(sql);
}
console.log(BEFORE ? "-- BEFORE: the old body (O1, O3, O4 must FAIL)" : "-- AFTER: migration applied 3x");

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${JSON.stringify(got)})`);
  if (!ok) failures++;
};
// The item is at latitude 30. "near" is 30.1 (about 7 miles), "far" is 32 (about 138). Every search has a 25-mile radius unless said.
const NEAR = 30.1, FAR = 32, LNG = -92;
const people = [
  ["O1", U(11), null, NEAR, 25], ["O2", U(12), null, null, 25], ["O3", U(13), FAR, NEAR, 25],
  ["O4", U(14), NEAR, FAR, 25], ["O5", U(15), NEAR, null, 25], ["O6", U(16), null, null, null],
];
await db.query(`INSERT INTO public.profiles (user_id) VALUES ($1)`, [SELLER]);
for (const [, u, profileLat, originLat, radius] of people) {
  await db.query(`INSERT INTO public.profiles (user_id, latitude, longitude) VALUES ($1, $2, $3)`, [u, profileLat, profileLat === null ? null : LNG]);
  await db.query(`INSERT INTO public.saved_searches (user_id, name, radius_miles, origin_lat, origin_lng) VALUES ($1, 'mug', $2, $3, $4)`, [u, radius, originLat, originLat === null ? null : LNG]);
}
const item = (await db.query(`INSERT INTO public.declutter_items (seller_id, title, current_price_cents) VALUES ($1, 'Blue mug', 500) RETURNING id`, [SELLER])).rows[0].id;
await db.query(`SELECT public.deliver_saved_search_item_alerts($1)`, [item]);
const told = async (u) => (await db.query(`SELECT count(*)::int n FROM public.bell WHERE user_id = $1`, [u])).rows[0].n;
const want = { O1: 1, O2: 0, O3: 1, O4: 0, O5: 1, O6: 1 };
for (const [id, u] of people) check(`${id}`, await told(u), want[id]);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);

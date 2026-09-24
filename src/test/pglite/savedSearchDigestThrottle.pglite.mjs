#!/usr/bin/env node
/**
 * PGlite proof for 20260924071011_saved_search_digest_skips_throttle (ST-011).
 *
 *   node src/test/pglite/savedSearchDigestThrottle.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/savedSearchDigestThrottle.pglite.mjs   # RED: live body
 *
 * The migration body IS the live function plus the fix; the RED run loads the
 * migration with the two ST-011 edits undone, which is the live definition
 * read 2026-09-24. Minimal fixture: only the columns the function reads.
 * net.http_post records calls; vault is a two-row table.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
let sql = readFileSync(
  new URL("../../../supabase/migrations/20260924071011_saved_search_digest_skips_throttle.sql", import.meta.url).pathname,
  "utf8",
);
if (process.env.NEW_MIGRATION === "skip") {
  console.log("NEW_MIGRATION=skip: running the LIVE (unfixed) body (expect FAILs)");
  sql = sql
    .replace(/\n\s*OR \(COALESCE\(np\.match_digest_mode, false\) AND NOT v_is_urgent\) -- ST-011 digest unthrottled/, "")
    .replace("  LOOP\n", "  LOOP\n    UPDATE public.saved_searches SET last_notified_at = now() WHERE id = ANY(match_record.matched_search_ids);\n");
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "11111111-0000-0000-0000-000000000001";
const DIGEST = "11111111-0000-0000-0000-000000000002";
const NOW_H = "11111111-0000-0000-0000-000000000003";

const db = new PGlite();
await db.exec(`
CREATE SCHEMA net; CREATE SCHEMA vault;
CREATE TABLE net.calls (body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls VALUES (body); SELECT 1::bigint $$;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url','http://x'),('service_role_key','k');
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.miles_between(a float8,b float8,c float8,d float8) RETURNS float8 LANGUAGE sql AS $$ SELECT 0::float8 $$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, email_verified boolean, ban_status text, latitude float8, longitude float8, parish text);
CREATE TABLE public.notification_preferences (user_id uuid PRIMARY KEY, job_matches boolean, match_digest_mode boolean);
CREATE TABLE public.saved_searches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, name text, created_at timestamptz DEFAULT now(),
  notify_enabled boolean, category text, parish text, max_budget numeric, min_budget numeric, query text, location_keyword text, radius_miles numeric, last_notified_at timestamptz);
CREATE TABLE public.match_digest_queue (user_id uuid, job_id uuid, UNIQUE (user_id, job_id));
CREATE TABLE public.notifications (user_id uuid, title text, message text, type text, link text);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, payment_status text, offered_to_helper_id uuid, direct_offer_status text,
  is_seed boolean, is_urgent boolean, customer_id uuid, category text, parish text, budget numeric, title text, description text, location text, latitude float8, longitude float8);
INSERT INTO public.profiles VALUES ('${DIGEST}', true, 'active', null, null, 'Orleans'), ('${NOW_H}', true, 'active', null, null, 'Orleans');
INSERT INTO public.notification_preferences VALUES ('${DIGEST}', true, true), ('${NOW_H}', true, false);
INSERT INTO public.saved_searches (user_id, name, notify_enabled) VALUES ('${DIGEST}', 'all', true), ('${NOW_H}', 'all', true);
`);
for (let i = 0; i < 3; i++) {
  await db.exec(sql);
  await db.exec(`CREATE OR REPLACE TRIGGER t AFTER INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.notify_saved_searches_on_new_job();`);
}
const job = (title, urgent) =>
  db.query(`INSERT INTO public.jobs (status, payment_status, customer_id, category, parish, budget, title, is_urgent)
            VALUES ('open','escrow',$1,'cleaning','Orleans',50,$2,$3)`, [POSTER, title, urgent]);
await job("first", false);
await job("second, ten minutes later", false);

const q = async (s, p = []) => (await db.query(s, p)).rows;
const digestRows = (await q(`SELECT count(*)::int n FROM public.match_digest_queue WHERE user_id = $1`, [DIGEST]))[0].n;
check("digest-mode helper gets BOTH matches queued (throttle no longer eats the second)", digestRows === 2, `queued ${digestRows}`);
const nowRows = (await q(`SELECT count(*)::int n FROM public.notifications WHERE user_id = $1`, [NOW_H]))[0].n;
check("immediate-mode helper is still throttled to one notification an hour", nowRows === 1, `notified ${nowRows}`);
const stamp = (await q(`SELECT last_notified_at FROM public.saved_searches WHERE user_id = $1`, [DIGEST]))[0].last_notified_at;
check("a digest match does not spend the throttle", stamp === null, `last_notified_at ${stamp}`);
await job("urgent", true);
const urgent = (await q(`SELECT count(*)::int n FROM public.notifications WHERE user_id = $1`, [DIGEST]))[0].n;
check("an urgent job still notifies the digest-mode helper immediately", urgent === 1, `notified ${urgent}`);

console.log(failures ? `\n${failures} FAIL` : "\nall PASS");
process.exit(failures ? 1 : 0);

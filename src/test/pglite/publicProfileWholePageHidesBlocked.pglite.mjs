#!/usr/bin/env node
/**
 * PGlite proof for 20261115073802_public_profile_hides_items_and_wanted_across_block (Q2809): a member's public page
 * applies ONE block rule. To a signed-in viewer in a block with the page's owner, either direction,
 * public_profile_by_handle lists none of the owner's open jobs (20261115064940), none of their live Declutter items
 * (listing_count 0) and none of their open Wanted posts; the page itself still loads. A guest and an unrelated member
 * see everything, as before. Grants unchanged.
 *
 *   node src/test/pglite/publicProfileWholePageHidesBlocked.pglite.mjs                    # GREEN: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/publicProfileWholePageHidesBlocked.pglite.mjs # RED: 20261115064940's body
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (override with PGLITE_DIR). The "before" function
 * is cut from its newest definition before this one (20261115064940), with the REAL mask_guest_contact and
 * job_offer_cutoff; everything else it calls is stubbed permissive, with Declutter and Wanted open to everyone. The
 * caller runs as `authenticated` with NO grant on user_blocks, so the block read must happen inside the definer.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGDIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const read = (f) => readFileSync(f.startsWith("/") ? f : MIGDIR + f, "utf8");
const NEW = read(process.env.MIGRATION_PATH ?? "20261115073802_public_profile_hides_items_and_wanted_across_block.sql");
const PREV = "20261115064940_teaser_profile_instant_match_hide_blocked.sql";
const GUEST_TEXT = "20261114234033_guests_read_masked_job_text.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

function cut(file, name) {
  const sql = read(file);
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const bodyStart = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], bodyStart);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ME = "a0000000-0000-4000-8000-000000000001";
const BLOCKER = "a0000000-0000-4000-8000-000000000002"; // blocked ME
const BLOCKED = "a0000000-0000-4000-8000-000000000003"; // ME blocked them
const CLEAN = "a0000000-0000-4000-8000-000000000004"; // no block with ME
const OTHER = "a0000000-0000-4000-8000-000000000005"; // blocked CLEAN

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.job_category AS ENUM ('cleaning', 'yard');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, category public.job_category DEFAULT 'yard', budget numeric DEFAULT 50,
  date_needed date DEFAULT (now() + interval '3 days')::date, start_time time, date_window_end date,
  location text DEFAULT 'Lafayette, LA', status public.job_status DEFAULT 'open', expires_at timestamptz, parent_job_id uuid,
  payment_status text DEFAULT 'escrow', customer_id uuid, helper_id uuid, offered_to_helper_id uuid, direct_offer_status text,
  credential_tier int DEFAULT 0, is_seed boolean DEFAULT false
);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, avatar_url text, created_at timestamptz DEFAULT now(),
  handle text, show_in_search boolean, bio text, location text, skills text, portfolio_urls text[],
  is_licensed boolean, license_status text, is_insured boolean, insurance_status text, business_name text,
  email_verified boolean DEFAULT true, ban_status text, is_seed boolean DEFAULT false, anonymized_at timestamptz);
CREATE TABLE public.profile_handles_retired (handle text, user_id uuid);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE TABLE public.user_blocks (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, blocker_id uuid NOT NULL, blocked_id uuid NOT NULL);
REVOKE ALL ON public.user_blocks FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE public.declutter_items (id uuid DEFAULT gen_random_uuid(), seller_id uuid, title text, current_price_cents int DEFAULT 500,
  area_label text, live_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(), status text DEFAULT 'live',
  seller_hidden boolean DEFAULT false, is_seed boolean DEFAULT false);
CREATE TABLE public.declutter_item_photos (id uuid, item_id uuid, position int);
CREATE TABLE public.feature_switches (key text, audience text);
INSERT INTO public.feature_switches VALUES ('declutter_wanted', 'everyone');
CREATE TABLE public.reviews (rating int, feedback text, tags text[], created_at timestamptz, response_text text,
  response_at timestamptz, reviewer_id uuid, reviewee_id uuid, job_id uuid, status text, feedback_visible_at timestamptz);
CREATE TABLE public.declutter_wanted (id uuid DEFAULT gen_random_uuid(), what text, category text, max_price_cents int,
  created_at timestamptz DEFAULT now(), user_id uuid, status text DEFAULT 'open', public boolean DEFAULT true,
  removed_at timestamptz, expires_at timestamptz DEFAULT now() + interval '7 days', is_seed boolean DEFAULT false);
CREATE FUNCTION public.mask_job_location(l text) RETURNS text LANGUAGE sql AS $$ SELECT l $$;
CREATE FUNCTION public.declutter_member_out(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_seller_out(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_seller_hidden(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_open_to_guests() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.member_under_18(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.is_test_member(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.member_display_name(n text) RETURNS text LANGUAGE sql AS $$ SELECT n $$;
CREATE FUNCTION public.review_text(f text, t text[]) RETURNS text LANGUAGE sql AS $$ SELECT f $$;
CREATE FUNCTION public.profile_review_same_person(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.get_public_profile_stats(ids uuid[]) RETURNS TABLE(user_id uuid, review_count int, avg_rating numeric,
  completed_jobs_as_helper int, completed_jobs_total int, posted_jobs_total int, on_time_rate numeric,
  repeat_hire_percent numeric, is_id_verified boolean, is_background_checked boolean)
  LANGUAGE sql AS $$ SELECT NULL::uuid, 0, NULL::numeric, 0, 0, 0, NULL::numeric, NULL::numeric, false, false WHERE false $$;
`);
await db.exec(cut(GUEST_TEXT, "mask_guest_contact"));
await db.exec(`GRANT EXECUTE ON FUNCTION public.mask_guest_contact(text) TO anon, authenticated, service_role;`);
await db.exec(cut("20261005184940_offer_deadline_before_start.sql", "job_offer_cutoff"));
await db.exec(cut(PREV, "public_profile_by_handle"));
// Supabase's default: a new function is EXECUTE-able by PUBLIC. Emulate, so the migration's REVOKE has to bite.
await db.exec(`GRANT EXECUTE ON FUNCTION public.public_profile_by_handle(text) TO PUBLIC, anon, authenticated, service_role;`);
let applied = 0;
if (!skip) for (let i = 0; i < 3; i++) { await db.exec(NEW); applied++; }
check("the migration applies three times", skip || applied === 3, `applied ${applied}`);

const owners = [[BLOCKER, "blocker"], [BLOCKED, "blocked"], [CLEAN, "clean"]];
for (const [u, h] of [[ME, "me"], ...owners, [OTHER, "other"]]) {
  await db.query(`INSERT INTO public.profiles (user_id, full_name, handle) VALUES ($1, $2, $3)`, [u, h, h]);
}
for (const [u, h] of owners) {
  await db.query(`INSERT INTO public.jobs (title, customer_id) VALUES ($1, $2)`, [`${h} job`, u]);
  await db.query(`INSERT INTO public.declutter_items (title, seller_id) VALUES ($1, $2), ($3, $2)`, [`${h} lamp`, u, `${h} chair`]);
  await db.query(`INSERT INTO public.declutter_wanted (what, user_id) VALUES ($1, $2)`, [`${h} wants a bike`, u]);
}
await db.exec(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES
  ('${BLOCKER}', '${ME}'), ('${ME}', '${BLOCKED}'), ('${OTHER}', '${CLEAN}');`);

async function page(role, sub, handle) {
  await db.exec(`RESET ROLE; SET request.jwt.claim.sub = '${sub ?? ""}'; SET ROLE ${role};`);
  try {
    return (await db.query(`SELECT public.public_profile_by_handle('${handle}') AS p`)).rows[0].p;
  } finally {
    await db.exec(`RESET ROLE;`);
  }
}
const sizes = (p) => `jobs ${p?.jobs?.length}/${p?.job_count}, items ${p?.listings?.length}/${p?.listing_count}, wanted ${p?.wanted?.length}`;
const hidden = (p) => p?.jobs?.length === 0 && p?.job_count === 0 && p?.listings?.length === 0 && p?.listing_count === 0 && p?.wanted?.length === 0;
const shown = (p) => p?.jobs?.length === 1 && p?.job_count === 1 && p?.listings?.length === 2 && p?.listing_count === 2 && p?.wanted?.length === 1;

const pBlocker = await page("authenticated", ME, "blocker");
check("the page of someone who blocked me still loads", pBlocker?.handle === "blocker");
check("...and lists none of their jobs, items or Wanted posts to me (counts 0)", hidden(pBlocker), sizes(pBlocker));
const pBlocked = await page("authenticated", ME, "blocked");
check("the page of someone I blocked loads and lists none of their jobs, items or Wanted posts to me", pBlocked?.handle === "blocked" && hidden(pBlocked), sizes(pBlocked));
const pOther = await page("authenticated", OTHER, "clean");
check("OTHER (who blocked CLEAN) sees none of CLEAN's jobs, items or Wanted posts", hidden(pOther), sizes(pOther));
const pClean = await page("authenticated", ME, "clean");
check("a page with no block between us lists everything to me", shown(pClean), sizes(pClean));
for (const [, h] of owners) {
  const g = await page("anon", null, h);
  check(`guest: ${h}'s page lists everything, as before`, shown(g), sizes(g));
}

const acl = (await db.query(`SELECT proacl::text AS acl, prosecdef FROM pg_proc WHERE oid = 'public.public_profile_by_handle(text)'::regprocedure`)).rows[0];
check("still SECURITY DEFINER", acl.prosecdef === true);
check("grants: anon, authenticated, service_role; never PUBLIC", ["anon=X", "authenticated=X", "service_role=X"].every((g) => acl.acl.includes(g)) && !/[{,]=X/.test(acl.acl), acl.acl);

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/**
 * PGlite proof for 20261115064940_teaser_profile_instant_match_hide_blocked (Q2807):
 *   - get_public_open_jobs (the landing teaser) never returns, to a signed-in member, a job whose poster blocked them
 *     or whom they blocked; a block between two OTHER members hides nothing; a guest and the service role read every
 *     row as before, and the guest still reads the masked title.
 *   - public_profile_by_handle lists no open jobs (job_count 0) to a viewer in a block with the page's owner, either
 *     direction; the page itself still comes back; a guest and an unrelated member see the jobs, the guest masked.
 *   - enqueue_instant_job_match never queues a member in a block with the poster (either direction), and the blocked
 *     member does not take one of the 20 slots; unrelated members are queued as before.
 *   - grants unchanged (never PUBLIC).
 *
 *   node src/test/pglite/teaserProfileMatchHideBlocked.pglite.mjs                    # GREEN: new migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/teaserProfileMatchHideBlocked.pglite.mjs # RED: the definitions on main
 *   MIGRATION_PATH=<planted copy> node ...                                            # RED on a planted defect
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (override with PGLITE_DIR). The "before"
 * functions are cut from their newest definitions before this one (20261114234033 for the teaser and the profile,
 * 20261009171601 for the match), with the REAL mask_guest_contact. Everything else they call is stubbed permissive.
 * The caller runs as `authenticated` with NO grant on user_blocks, so the block read must happen inside the definer.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGDIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const read = (f) => readFileSync(f.startsWith("/") ? f : MIGDIR + f, "utf8");
const NEW = read(process.env.MIGRATION_PATH ?? "20261115064940_teaser_profile_instant_match_hide_blocked.sql");
const GUEST_TEXT = "20261114234033_guests_read_masked_job_text.sql";
const ALERTS = "20261009171601_job_alerts_reach_every_member.sql";
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
const BLOCKED_ME = "a0000000-0000-4000-8000-000000000002"; // blocked ME
const I_BLOCKED = "a0000000-0000-4000-8000-000000000003"; // ME blocked them
const CLEAN = "a0000000-0000-4000-8000-000000000004"; // no block with ME
const OTHER = "a0000000-0000-4000-8000-000000000005"; // in a block with CLEAN only
const J = { blockedMe: "b0000000-0000-4000-8000-000000000002", iBlocked: "b0000000-0000-4000-8000-000000000003", clean: "b0000000-0000-4000-8000-000000000004" };
const RAW_TITLE = "no block: call 337-555-0142 or mail a@b.co";
const MASKED_TITLE = "no block: call [phone hidden] or mail [email hidden]";

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
  id uuid PRIMARY KEY, title text, category public.job_category DEFAULT 'yard', budget numeric DEFAULT 50,
  date_needed date DEFAULT (now() + interval '3 days')::date, start_time time, date_window_end date,
  location text DEFAULT 'Lafayette, LA', is_urgent boolean DEFAULT false, is_group_job boolean DEFAULT false,
  status public.job_status DEFAULT 'open', created_at timestamptz DEFAULT now() - interval '1 day',
  expires_at timestamptz, boost_expires_at timestamptz, parent_job_id uuid,
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
CREATE TABLE public.declutter_items (id uuid, seller_id uuid, title text, current_price_cents int, area_label text,
  live_at timestamptz, created_at timestamptz, status text, seller_hidden boolean, is_seed boolean);
CREATE TABLE public.declutter_item_photos (id uuid, item_id uuid, position int);
CREATE TABLE public.feature_switches (key text, audience text);
CREATE TABLE public.reviews (rating int, feedback text, tags text[], created_at timestamptz, response_text text,
  response_at timestamptz, reviewer_id uuid, reviewee_id uuid, job_id uuid, status text, feedback_visible_at timestamptz);
CREATE TABLE public.declutter_wanted (id uuid, what text, category text, max_price_cents int, created_at timestamptz,
  user_id uuid, status text, public boolean, removed_at timestamptz, expires_at timestamptz, is_seed boolean);
CREATE TABLE public.job_match_queue (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid, job_id uuid, source text,
  notify_at timestamptz, title text, message text, link text, send_email boolean, status text DEFAULT 'queued',
  drop_reason text, settled_at timestamptz, attempts int DEFAULT 0, retry_after timestamptz, UNIQUE (user_id, job_id));
CREATE TABLE public.error_logs (severity text, message text, tags jsonb);
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() $$;
CREATE FUNCTION public.early_access_visible_at(u uuid, t timestamptz) RETURNS timestamptz LANGUAGE sql AS $$ SELECT t $$;
CREATE FUNCTION public.deliver_job_match(q uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.job_announceable_to(p_job public.jobs, p_user_id uuid) RETURNS boolean LANGUAGE sql
  AS $$ SELECT p_user_id IS NOT NULL AND p_job.customer_id <> p_user_id $$;
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.get_user_credential_tier(u uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.crew_spots_open(j uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.mask_job_location(l text) RETURNS text LANGUAGE sql AS $$ SELECT l $$;
CREATE FUNCTION public.declutter_member_out(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_seller_out(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_seller_hidden(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_open_to_guests() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
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
await db.exec(cut(GUEST_TEXT, "get_public_open_jobs"));
await db.exec(cut(GUEST_TEXT, "public_profile_by_handle"));
await db.exec(cut(ALERTS, "enqueue_instant_job_match"));
// Supabase's default: a new function is EXECUTE-able by PUBLIC. Emulate, so the migration's REVOKE has to bite.
await db.exec(`GRANT EXECUTE ON FUNCTION public.get_public_open_jobs(integer) TO PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.public_profile_by_handle(text) TO PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.enqueue_instant_job_match(uuid, jsonb) TO PUBLIC, service_role;`);
if (!skip) for (let i = 0; i < 3; i++) await db.exec(NEW);

await db.exec(`
  INSERT INTO public.jobs (id, title, customer_id) VALUES
    ('${J.blockedMe}', 'poster blocked me', '${BLOCKED_ME}'),
    ('${J.iBlocked}', 'I blocked the poster', '${I_BLOCKED}'),
    ('${J.clean}', '${RAW_TITLE}', '${CLEAN}');
  INSERT INTO public.profiles (user_id, full_name, handle) VALUES
    ('${ME}', 'Me', 'me'), ('${BLOCKED_ME}', 'Blocker', 'blocker'), ('${I_BLOCKED}', 'Blocked', 'blocked'),
    ('${CLEAN}', 'Clean', 'clean'), ('${OTHER}', 'Other', 'other');
  INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES
    ('${BLOCKED_ME}', '${ME}'),
    ('${ME}', '${I_BLOCKED}'),
    ('${OTHER}', '${CLEAN}');`);

async function as(role, sub, sql) {
  await db.exec(`RESET ROLE; SET request.jwt.claim.sub = '${sub ?? ""}'; SET ROLE ${role};`);
  try {
    return (await db.query(sql)).rows;
  } finally {
    await db.exec(`RESET ROLE;`);
  }
}

// 1. The landing teaser.
const teaser = async (role, sub) => {
  const rows = await as(role, sub, `SELECT id, title FROM public.get_public_open_jobs(50)`);
  const set = new Set(rows.map((r) => r.id));
  set.titles = new Map(rows.map((r) => [r.id, r.title]));
  return set;
};
const tMe = await teaser("authenticated", ME);
check("teaser: member: a job from a poster who blocked me is not listed", !tMe.has(J.blockedMe));
check("teaser: member: a job from a poster I blocked is not listed", !tMe.has(J.iBlocked));
check("teaser: member: a job from a poster with no block with me is listed, title raw", tMe.titles.get(J.clean) === RAW_TITLE, String(tMe.titles.get(J.clean)));
const tOther = await teaser("authenticated", OTHER);
check("teaser: the other side: OTHER (who blocked CLEAN) does not see CLEAN's job", !tOther.has(J.clean));
check("teaser: the other side: OTHER still sees posters they have no block with", tOther.has(J.blockedMe) && tOther.has(J.iBlocked));
const tGuest = await teaser("anon", null);
check("teaser: guest: every job listed, as before", [J.blockedMe, J.iBlocked, J.clean].every((id) => tGuest.has(id)), `${tGuest.size} rows`);
check("teaser: guest: the CLEAN title is still masked", tGuest.titles.get(J.clean) === MASKED_TITLE, String(tGuest.titles.get(J.clean)));
const tSvc = await teaser("service_role", null);
check("teaser: service role (no session): every job listed, as before", [J.blockedMe, J.iBlocked, J.clean].every((id) => tSvc.has(id)));

// 2. The public profile page.
const profile = async (role, sub, handle) => (await as(role, sub, `SELECT public.public_profile_by_handle('${handle}') AS p`))[0].p;
const pBlocker = await profile("authenticated", ME, "blocker");
check("profile: the page of someone who blocked me still loads", pBlocker?.handle === "blocker");
check("profile: ...but lists none of their open jobs to me (job_count 0)", pBlocker?.jobs?.length === 0 && pBlocker?.job_count === 0, JSON.stringify(pBlocker?.jobs));
const pBlocked = await profile("authenticated", ME, "blocked");
check("profile: the page of someone I blocked lists none of their open jobs to me", pBlocked?.jobs?.length === 0 && pBlocked?.job_count === 0, JSON.stringify(pBlocked?.jobs));
const pCleanByMe = await profile("authenticated", ME, "clean");
check("profile: a page with no block lists its open job to me, title raw", pCleanByMe?.jobs?.length === 1 && pCleanByMe.jobs[0].title === RAW_TITLE && pCleanByMe.job_count === 1, JSON.stringify(pCleanByMe?.jobs));
const pCleanByOther = await profile("authenticated", OTHER, "clean");
check("profile: OTHER (who blocked CLEAN) sees none of CLEAN's open jobs", pCleanByOther?.jobs?.length === 0 && pCleanByOther?.job_count === 0);
const pBlockerByGuest = await profile("anon", null, "blocker");
check("profile: guest: the blocker's open job is listed, as before", pBlockerByGuest?.jobs?.length === 1 && pBlockerByGuest.job_count === 1);
const pCleanByGuest = await profile("anon", null, "clean");
check("profile: guest: the CLEAN job's title is still masked", pCleanByGuest?.jobs?.[0]?.title === MASKED_TITLE, JSON.stringify(pCleanByGuest?.jobs));

// 3. The instant job match. CLEAN posts; OTHER blocked CLEAN. A second job by BLOCKED_ME: ME is blocked by the poster.
//    A third by ME: I_BLOCKED is someone the poster blocked.
await db.exec(`INSERT INTO public.jobs (id, title, customer_id) VALUES
  ('c0000000-0000-4000-8000-000000000002', 'by the blocker', '${BLOCKED_ME}'),
  ('c0000000-0000-4000-8000-000000000001', 'by me', '${ME}');`);
const match = (u) => ({ user_id: u, title: "New job", message: "near you", link: "/jobs/x" });
const enqueue = async (jobId, users) =>
  (await as("service_role", null, `SELECT public.enqueue_instant_job_match('${jobId}', '${JSON.stringify(users.map(match))}'::jsonb) AS r`))[0].r;
const queued = async (jobId) => new Set((await db.query(`SELECT user_id FROM public.job_match_queue WHERE job_id = '${jobId}'`)).rows.map((r) => r.user_id));

await db.exec(`GRANT SELECT, INSERT, UPDATE ON public.jobs, public.job_match_queue, public.error_logs TO service_role;`);
const r1 = await enqueue(J.clean, [OTHER, ME]);
const q1 = await queued(J.clean);
check("match: a member who blocked the poster is never queued", !q1.has(OTHER), JSON.stringify(r1));
check("match: an unrelated member is still queued and sent", q1.has(ME) && r1.queued === 1 && r1.sent_now === 1, JSON.stringify(r1));
check("match: the blocked member is not counted eligible (takes none of the 20 slots)", r1.eligible === 1, JSON.stringify(r1));
const r2 = await enqueue("c0000000-0000-4000-8000-000000000002", [ME, CLEAN]);
const q2 = await queued("c0000000-0000-4000-8000-000000000002");
check("match: a member the poster blocked is never queued", !q2.has(ME) && q2.has(CLEAN), JSON.stringify(r2));
const r3 = await enqueue("c0000000-0000-4000-8000-000000000001", [I_BLOCKED, CLEAN]);
const q3 = await queued("c0000000-0000-4000-8000-000000000001");
check("match: the poster blocked them -> never queued (the other direction)", !q3.has(I_BLOCKED) && q3.has(CLEAN), JSON.stringify(r3));
// 20 blocked members first, then one clean one: the clean one must still be reached (slots not spent on blocked pairs).
const many = Array.from({ length: 20 }, (_, i) => `d0000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
await db.exec(`INSERT INTO public.user_blocks (blocker_id, blocked_id) SELECT u::uuid, '${CLEAN}' FROM unnest(ARRAY['${many.join("','")}']) u;
  INSERT INTO public.jobs (id, title, customer_id) VALUES ('c0000000-0000-4000-8000-000000000009', 'slots', '${CLEAN}');`);
const r4 = await enqueue("c0000000-0000-4000-8000-000000000009", [...many, ME]);
const q4 = await queued("c0000000-0000-4000-8000-000000000009");
check("match: 20 blocked members ahead in the list do not use up the 20 slots; the clean member is still reached", q4.size === 1 && q4.has(ME), JSON.stringify(r4));

// Grants.
for (const [sig, want, deny] of [
  ["get_public_open_jobs(integer)", ["anon=X", "authenticated=X", "service_role=X"], []],
  ["public_profile_by_handle(text)", ["anon=X", "authenticated=X", "service_role=X"], []],
  ["enqueue_instant_job_match(uuid, jsonb)", ["service_role=X"], ["anon=X", "authenticated=X"]],
]) {
  const acl = (await db.query(`SELECT proacl::text AS acl, prosecdef FROM pg_proc WHERE oid = 'public.${sig}'::regprocedure`)).rows[0];
  check(`${sig}: still SECURITY DEFINER`, acl.prosecdef === true);
  check(`${sig}: grants: ${want.join(", ")}`, want.every((g) => acl.acl.includes(g)), acl.acl);
  check(`${sig}: grants: never PUBLIC${deny.length ? `, ${deny.join(", ")}` : ""}`, !/[{,]=X/.test(acl.acl) && deny.every((g) => !acl.acl.includes(g)), acl.acl);
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/**
 * PGlite proof for 20261115063613_ranked_jobs_hide_blocked_keep_guest_mask: get_ranked_open_jobs (the new member Home's "Jobs near
 * you") and get_open_jobs_for_map (the Browse map's pins) never return a job whose poster blocked the caller, or whom the caller blocked; a block between two OTHER
 * members hides nothing; a guest and the service role (no session) read the same rows as before; the grants are
 * unchanged (anon, authenticated, service_role; never PUBLIC); and the guest copy is still masked (20261114234033's
 * mask_guest_contact on title, description and special requirements) WHILE the block filter holds: masking and blocking
 * together, on the same rows.
 *
 *   node src/test/pglite/rankedJobsHideBlocked.pglite.mjs                    # GREEN: the new migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/rankedJobsHideBlocked.pglite.mjs # RED: the definition on main
 *   MIGRATION_PATH=<planted copy> node ...                                    # RED on a planted defect
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (override with PGLITE_DIR). The "before"
 * functions are cut from 20261114234033 (both), the newest definitions before this one, with the REAL
 * mask_guest_contact from the same file. Everything it calls that is not the rule under
 * test is stubbed permissive (no seed switch, no early access, tier 0, memberships off). The caller runs as the
 * `authenticated` role with NO grant on user_blocks, so the block read must happen inside the definer.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGDIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const read = (f) => readFileSync(f.startsWith("/") ? f : MIGDIR + f, "utf8");
const NEW = read(process.env.MIGRATION_PATH ?? "20261115063613_ranked_jobs_hide_blocked_keep_guest_mask.sql");
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
const BLOCKED_ME = "a0000000-0000-4000-8000-000000000002"; // blocked ME
const I_BLOCKED = "a0000000-0000-4000-8000-000000000003"; // ME blocked them
const CLEAN = "a0000000-0000-4000-8000-000000000004"; // no block with ME
const OTHER = "a0000000-0000-4000-8000-000000000005"; // in a block with CLEAN only
const J = { blockedMe: "b0000000-0000-4000-8000-000000000002", iBlocked: "b0000000-0000-4000-8000-000000000003", clean: "b0000000-0000-4000-8000-000000000004", mine: "b0000000-0000-4000-8000-000000000001" };

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
  id uuid PRIMARY KEY, title text, description text, category public.job_category DEFAULT 'yard', budget numeric DEFAULT 50,
  date_needed date, start_time time, date_window_end date, location text DEFAULT 'Lafayette, LA', parish text,
  is_urgent boolean DEFAULT false, urgent_fee numeric, is_flexible_schedule boolean DEFAULT false,
  is_recurring boolean DEFAULT false, recurrence_interval text, is_group_job boolean DEFAULT false,
  helpers_needed int DEFAULT 1, estimated_hours numeric, photos text[], special_requirements text,
  status public.job_status DEFAULT 'open', created_at timestamptz DEFAULT now() - interval '1 day',
  expires_at timestamptz, boosted_at timestamptz, boost_expires_at timestamptz, parent_job_id uuid,
  payment_status text DEFAULT 'escrow', customer_id uuid, offered_to_helper_id uuid, direct_offer_status text,
  pricing_mode text, latitude numeric DEFAULT 30.22, longitude numeric DEFAULT -92.02, credential_tier int DEFAULT 0,
  is_seed boolean DEFAULT false, helper_fee_flat_cents integer, helper_fee_percent numeric, zip_code text
);
CREATE TABLE public.louisiana_zip_parishes (zip_code text, parish text, latitude numeric, longitude numeric);
CREATE TABLE public.profiles (user_id uuid, parish text, latitude numeric, longitude numeric, subscription_tier text,
  subscription_expires_at timestamptz);
CREATE TABLE public.ban_settlement_queue (user_id uuid, review_state text);
CREATE TABLE public.user_blocks (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, blocker_id uuid NOT NULL, blocked_id uuid NOT NULL);
REVOKE ALL ON public.user_blocks FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.early_access_cutoff() RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() $$;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.get_user_credential_tier(u uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.miles_between(a numeric, b numeric, c numeric, d numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT NULL::numeric $$;
CREATE FUNCTION public.feature_enabled_for_user(k text, u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.crew_spots_open(j uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.mask_job_location(l text) RETURNS text LANGUAGE sql AS $$ SELECT l $$;
`);
await db.exec(cut(GUEST_TEXT, "mask_guest_contact"));
await db.exec(`GRANT EXECUTE ON FUNCTION public.mask_guest_contact(text) TO anon, authenticated, service_role;`);
await db.exec(cut("20261005184940_offer_deadline_before_start.sql", "job_offer_cutoff"));
// Supabase's default: a new function is EXECUTE-able by PUBLIC. Emulate, so the migration's REVOKE has to bite.
await db.exec(cut(GUEST_TEXT, "get_ranked_open_jobs"));
await db.exec(cut(GUEST_TEXT, "get_open_jobs_for_map"));
await db.exec(`GRANT EXECUTE ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) TO PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.get_open_jobs_for_map() TO PUBLIC, anon, authenticated, service_role;`);
if (!skip) for (let i = 0; i < 3; i++) await db.exec(NEW);

await db.exec(`
  INSERT INTO public.jobs (id, title, customer_id) VALUES
    ('${J.blockedMe}', 'poster blocked me', '${BLOCKED_ME}'),
    ('${J.iBlocked}', 'I blocked the poster', '${I_BLOCKED}'),
    ('${J.clean}', 'no block: call 337-555-0142 or mail a@b.co', '${CLEAN}'),
    ('${J.mine}', 'my own', '${ME}');
  INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES
    ('${BLOCKED_ME}', '${ME}'),
    ('${ME}', '${I_BLOCKED}'),
    ('${OTHER}', '${CLEAN}');`);

const SURFACES = {
  get_ranked_open_jobs: { sql: `SELECT id, title FROM public.get_ranked_open_jobs(50, 0, true, NULL, NULL, NULL)`, sig: "get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric)" },
  get_open_jobs_for_map: { sql: `SELECT id, title FROM public.get_open_jobs_for_map()`, sig: "get_open_jobs_for_map()" },
};
const RAW_TITLE = "no block: call 337-555-0142 or mail a@b.co";
const MASKED_TITLE = "no block: call [phone hidden] or mail [email hidden]";
for (const [fn, { sql, sig }] of Object.entries(SURFACES)) {
  const listed = async (role, sub) => {
    await db.exec(`RESET ROLE; SET request.jwt.claim.sub = '${sub ?? ""}'; SET ROLE ${role};`);
    try {
      const rows = (await db.query(sql)).rows;
      const set = new Set(rows.map((r) => r.id));
      set.titles = new Map(rows.map((r) => [r.id, r.title]));
      return set;
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  };

  const me = await listed("authenticated", ME);
  check(`${fn}: member: a job from a poster who blocked me is not listed`, !me.has(J.blockedMe));
  check(`${fn}: member: a job from a poster I blocked is not listed`, !me.has(J.iBlocked));
  check(`${fn}: member: a job from a poster with no block with me is listed (a block between two OTHER members hides nothing)`, me.has(J.clean));
  check(`${fn}: member: my own job is still never listed`, !me.has(J.mine));

  const other = await listed("authenticated", OTHER);
  check(`${fn}: the other side: OTHER (who blocked CLEAN) does not see CLEAN's job`, !other.has(J.clean));
  check(`${fn}: the other side: OTHER still sees jobs of posters they have no block with`, other.has(J.blockedMe) && other.has(J.iBlocked));

  const guest = await listed("anon", null);
  check(`${fn}: guest: every open job is listed, as before`, [J.blockedMe, J.iBlocked, J.clean, J.mine].every((id) => guest.has(id)), `${guest.size} rows`);
  // Masking AND blocking together (the reason this migration replaced 20261115023248, which restated the
  // pre-mask bodies): a guest reads the masked title, a member with no block reads the raw title, and the member who
  // blocked that poster reads neither, on the same call.
  check(`${fn}: masking + blocking: the guest reads the CLEAN job's title masked`, guest.titles.get(J.clean) === MASKED_TITLE, String(guest.titles.get(J.clean)));
  check(`${fn}: masking + blocking: a member with no block reads the CLEAN job's title raw`, me.titles.get(J.clean) === RAW_TITLE, String(me.titles.get(J.clean)));
  check(`${fn}: masking + blocking: OTHER (blocked CLEAN) gets no row at all, masked or raw`, !other.has(J.clean) && ![...other.titles.values()].some((t) => t === RAW_TITLE || t === MASKED_TITLE));
  const svc = await listed("service_role", null);
  check(`${fn}: service role (no session): every open job is listed, as before`, [J.blockedMe, J.iBlocked, J.clean, J.mine].every((id) => svc.has(id)), `${svc.size} rows`);

  const acl = (await db.query(`SELECT proacl::text AS acl, prosecdef FROM pg_proc WHERE oid = 'public.${sig}'::regprocedure`)).rows[0];
  check(`${fn}: still SECURITY DEFINER`, acl.prosecdef === true);
  check(`${fn}: grants: anon, authenticated and service_role may EXECUTE`, ["anon=X", "authenticated=X", "service_role=X"].every((g) => acl.acl.includes(g)), acl.acl);
  check(`${fn}: grants: PUBLIC may not EXECUTE`, !/[{,]=X/.test(acl.acl), acl.acl);
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);

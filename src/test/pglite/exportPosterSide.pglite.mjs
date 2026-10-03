#!/usr/bin/env node
/**
 * PGlite proof for 20261004162818_export_poster_side_of_job_rows (Q739): Download My Data gives the poster their
 * side of the two-party rows on their own jobs.
 *
 *   node src/test/pglite/exportPosterSide.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/exportPosterSide.pglite.mjs   # RED: the live body
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * export_my_data reads dozens of tables, so the proof runs the sections this
 * migration touches VERBATIM: each `jsonb_build_object('<name>', (SELECT …))`
 * expression is cut out of the function body in the migration file (the live
 * body, 20261002052502, under NEW_MIGRATION=skip) and evaluated with v_uid
 * bound to a caller, against the tables' live column shapes
 * (information_schema, 2026-10-03). Then:
 *   - the poster's export holds the rows on THEIR jobs / series, never the
 *     rows on another poster's job;
 *   - the Helpr's export still holds their own rows, unchanged;
 *   - a fee share's stripe_transfer_id, status and paid_at are the crew
 *     member's: stripped from the poster's copy, kept in the Helpr's;
 *   - (review of this migration) an application to the poster's job gives the
 *     poster their own decision on it and none of the applicant's fields, and
 *     never an application from someone blocked with the poster; a crew
 *     roster row gives the poster their own confirmations only; a revision on
 *     the poster's job filed under another requested_by is still theirs;
 *   - the migration's function body compiles and is applied 3x.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
const FILE = MODE === "skip"
  ? "../../../supabase/migrations/20261002052502_cancellation_fee_transfers_ledger.sql"
  : "../../../supabase/migrations/20261004162818_export_poster_side_of_job_rows.sql";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running the LIVE body (expect FAILs)`);
const SQL = read(FILE);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

/** `(SELECT … )` of section `name`, cut from the export_my_data body (balanced parens). */
function section(name) {
  const body = SQL.slice(SQL.indexOf("FUNCTION public.export_my_data(p_user_id uuid)"));
  const at = body.indexOf(`jsonb_build_object('${name}', (`);
  if (at < 0) return null;
  let i = body.indexOf("(", at + `jsonb_build_object('${name}', `.length);
  const from = i;
  let depth = 0;
  for (; i < body.length; i++) {
    if (body[i] === "(") depth++;
    else if (body[i] === ")" && --depth === 0) break;
  }
  return body.slice(from, i + 1);
}

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const OTHER_POSTER = "96c9899e-87a2-49e2-bbdd-268717d52aee";
const HELPER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const MINE = "10000000-0000-4000-8000-000000000001"; // the poster's job / series parent
const THEIRS = "10000000-0000-4000-8000-000000000002"; // another poster's job / series parent
const PET = "50000000-0000-4000-8000-000000000001";
const BLOCKED = "33333333-3333-4333-8333-333333333333"; // an applicant blocked with the poster

const db = new PGlite();
await db.exec(`
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid);
CREATE TABLE public.series_date_offers (id uuid DEFAULT gen_random_uuid(), parent_job_id uuid, helper_id uuid, offered_at timestamptz DEFAULT now());
CREATE TABLE public.series_visit_holds (parent_job_id uuid, visit_date date, helper_id uuid, id uuid DEFAULT gen_random_uuid(), claimed_at timestamptz DEFAULT now());
CREATE TABLE public.crew_dispute_member_outcomes (id uuid DEFAULT gen_random_uuid(), dispute_id uuid, job_id uuid, helper_id uuid, slot_no integer, share_cents integer, member_outcome text, decided_by uuid, decided_at timestamptz);
CREATE TABLE public.crew_cancellation_fee_shares (id uuid DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, committed boolean, share_basis_cents integer, fee_percent integer, share_amount numeric, status text, stripe_transfer_id text, created_at timestamptz DEFAULT now(), paid_at timestamptz);
CREATE TABLE public.recurring_visit_releases (id uuid DEFAULT gen_random_uuid(), parent_job_id uuid, helper_id uuid, visit_date date, reason text, created_at timestamptz DEFAULT now());
CREATE TABLE public.job_pets (job_id uuid, pet_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.applications (id uuid DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, message text, status text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), attachment_urls text[], offer_message text, stake_amount numeric, stake_status text, poster_viewed_at timestamptz, decline_reason text, flagged_hidden boolean DEFAULT false, flag_reason text, job_latitude numeric, job_longitude numeric, closed_reason text);
CREATE TABLE public.group_job_helpers (id uuid DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text, joined_at timestamptz, helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz, helper_on_the_way_at timestamptz, helper_arrived_at timestamptz, helper_arrival_verified_at timestamptz, helper_arrival_near_miss_at timestamptz, helper_arrival_near_miss_ft integer, poster_confirmed_arrival_at timestamptz, poster_confirmed_working_at timestamptz, helper_completed_at timestamptz, poster_confirmed_completion_at timestamptz, proof_before_urls text[], proof_after_urls text[], slot_no integer, share_cents integer);
CREATE TABLE public.job_revisions (id uuid DEFAULT gen_random_uuid(), job_id uuid, requested_by uuid, status text, description text, photos text[], helper_response text, resolved_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
-- are_users_blocked as it answers in the export (a server context: the real answer).
CREATE FUNCTION public.are_users_blocked(_user_a uuid, _user_b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_blocks WHERE (blocker_id = _user_a AND blocked_id = _user_b) OR (blocker_id = _user_b AND blocked_id = _user_a)) $$;
INSERT INTO public.jobs VALUES ('${MINE}', '${POSTER}', '${HELPER}'), ('${THEIRS}', '${OTHER_POSTER}', '${HELPER}');
INSERT INTO public.series_date_offers (parent_job_id, helper_id) VALUES ('${MINE}', '${HELPER}'), ('${THEIRS}', '${HELPER}');
INSERT INTO public.series_visit_holds (parent_job_id, visit_date, helper_id) VALUES ('${MINE}', '2026-10-10', '${HELPER}'), ('${THEIRS}', '2026-10-11', '${HELPER}');
INSERT INTO public.crew_dispute_member_outcomes (job_id, helper_id, slot_no, share_cents, member_outcome, decided_by) VALUES
  ('${MINE}', '${HELPER}', 1, 5000, 'paid', '22222222-2222-4222-8222-222222222222'), ('${THEIRS}', '${HELPER}', 1, 7000, 'refunded', NULL);
INSERT INTO public.crew_cancellation_fee_shares (job_id, helper_id, committed, share_basis_cents, fee_percent, share_amount, status, stripe_transfer_id) VALUES
  ('${MINE}', '${HELPER}', true, 10000, 25, 25, 'paid', 'tr_helper_mine'), ('${THEIRS}', '${HELPER}', true, 10000, 50, 50, 'paid', 'tr_helper_theirs');
INSERT INTO public.recurring_visit_releases (parent_job_id, helper_id, visit_date, reason) VALUES ('${MINE}', '${HELPER}', '2026-10-12', 'sick'), ('${THEIRS}', '${HELPER}', '2026-10-13', 'car');
INSERT INTO public.job_pets (job_id, pet_id) VALUES ('${MINE}', '${PET}'), ('${THEIRS}', '${PET}');
INSERT INTO public.applications (job_id, helper_id, message, status, offer_message, stake_amount, poster_viewed_at, decline_reason, flag_reason, attachment_urls) VALUES
  ('${MINE}', '${HELPER}', 'pick me', 'declined', 'Come Saturday?', 5, now(), 'Found someone closer', 'contact-leak', ARRAY['${HELPER}/a.jpg']),
  ('${THEIRS}', '${HELPER}', 'me too', 'pending', NULL, 0, NULL, NULL, NULL, '{}'),
  ('${MINE}', '${BLOCKED}', 'blocked one', 'pending', NULL, 0, NULL, NULL, NULL, '{}');
INSERT INTO public.user_blocks VALUES ('${POSTER}', '${BLOCKED}');
INSERT INTO public.group_job_helpers (job_id, helper_id, status, slot_no, share_cents, poster_confirmed_arrival_at, helper_arrival_near_miss_ft, proof_before_urls) VALUES
  ('${MINE}', '${HELPER}', 'active', 1, 5000, now(), 320, ARRAY['${HELPER}/before.jpg']),
  ('${THEIRS}', '${HELPER}', 'active', 1, 7000, NULL, NULL, '{}');
INSERT INTO public.job_revisions (job_id, requested_by, status, description) VALUES
  ('${MINE}', '${HELPER}', 'open', 'filed under the Helpr, on the poster''s job'),
  ('${THEIRS}', '${OTHER_POSTER}', 'open', 'another poster''s');
`);

// The migration itself is applied 3x: plpgsql resolves the tables its body
// reads at run time, not at CREATE time, so the function is created here even
// though only the six sections' tables exist (its body is never called whole).
if (MODE !== "skip") {
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;");
  await db.exec("CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz);");
  for (let i = 0; i < 3; i++) {
    const r = await db.exec(SQL).then(() => ({ ok: true }), (e) => ({ ok: false, err: e.message }));
    check(`F${i + 1} the migration applies (apply ${i + 1} of 3)`, r.ok, r.err ?? "");
  }
  const f = (await db.query(`SELECT prosecdef, proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure('public.export_my_data(uuid)')`)).rows[0];
  check("F4 export_my_data(uuid) exists, SECURITY DEFINER, service_role only", f && f.prosecdef === true && /service_role=X/.test(f.acl) && !/(^|[{,])(anon|authenticated)?=X/.test(f.acl), JSON.stringify(f));
  const legacy = (await db.query(`SELECT to_regprocedure('public.export_my_data()') AS r`)).rows[0].r;
  check("F5 the no-argument door stays dropped", legacy === null, String(legacy));
}

async function exportOf(name, uid) {
  const expr = section(name);
  if (!expr) return { missing: true };
  const r = await db.query(`SELECT ${expr.replace(/\bv_uid\b/g, `'${uid}'::uuid`)} AS rows`);
  return { rows: r.rows[0].rows ?? [] };
}
const jobsOf = (rows, col) => rows.map((x) => x[col]).sort();

for (const [name, col] of [
  ["series_date_offers", "parent_job_id"],
  ["series_visit_holds", "parent_job_id"],
  ["crew_dispute_member_outcomes", "job_id"],
  ["crew_cancellation_fee_shares", "job_id"],
  ["recurring_visit_releases", "parent_job_id"],
  ["job_pets", "job_id"],
  ["applications", "job_id"],
  ["group_job_helpers", "job_id"],
  ["job_revisions", "job_id"],
]) {
  const p = await exportOf(name, POSTER);
  check(
    `P ${name}: the poster gets the row on their own job, not another poster's${name === "applications" ? " (and not a blocked applicant's)" : ""}`,
    !p.missing && JSON.stringify(jobsOf(p.rows, col)) === JSON.stringify([MINE]),
    p.missing ? "no such section" : JSON.stringify(jobsOf(p.rows, col)),
  );
  if (name === "job_pets") continue; // no Helpr side: the pets are the poster's
  const h = await exportOf(name, HELPER);
  check(
    `H ${name}: the Helpr still gets every row of their own`,
    !h.missing && JSON.stringify(jobsOf(h.rows, col)) === JSON.stringify([MINE, THEIRS].sort()),
    h.missing ? "no such section" : JSON.stringify(jobsOf(h.rows, col)),
  );
}
{
  const p = await exportOf("crew_cancellation_fee_shares", POSTER);
  const h = await exportOf("crew_cancellation_fee_shares", HELPER);
  check(
    "S1 a fee share's stripe_transfer_id, status and paid_at are stripped from the poster's copy and kept in the Helpr's",
    !p.missing && p.rows.length === 1 && !("stripe_transfer_id" in p.rows[0]) && !("status" in p.rows[0]) && !("paid_at" in p.rows[0]) &&
      h.rows.every((x) => typeof x.stripe_transfer_id === "string" && "status" in x),
    JSON.stringify({ poster: p.rows?.map((x) => Object.keys(x).includes("stripe_transfer_id")), helper: h.rows?.map((x) => x.stripe_transfer_id) }),
  );
  const o = await exportOf("crew_dispute_member_outcomes", POSTER);
  check("S2 the staff decider stays stripped from the poster's copy", !o.missing && o.rows.every((x) => !("decided_by" in x)), JSON.stringify(o.rows?.map((x) => Object.keys(x))));
  const a = await exportOf("applications", POSTER);
  const ak = a.rows?.[0] ? Object.keys(a.rows[0]) : [];
  check(
    "S3 the poster's copy of an application is the poster's decision, none of the applicant's fields",
    !a.missing && a.rows.length === 1 && ["decline_reason", "poster_viewed_at", "offer_message", "status"].every((k) => ak.includes(k)) &&
      ["message", "stake_amount", "flag_reason", "attachment_urls", "job_latitude"].every((k) => !ak.includes(k)),
    JSON.stringify(ak),
  );
  const ha = await exportOf("applications", HELPER);
  check("S4 the applicant still gets their whole application", !ha.missing && ha.rows.every((x) => "message" in x && "stake_amount" in x), JSON.stringify(ha.rows?.length));
  const b = await exportOf("applications", BLOCKED);
  check("S5 the blocked applicant still gets their own application", !b.missing && b.rows.length === 1, JSON.stringify(b.rows?.length));
  const g = await exportOf("group_job_helpers", POSTER);
  const gk = g.rows?.[0] ? Object.keys(g.rows[0]) : [];
  check(
    "S6 the poster's copy of a roster row is the poster's confirmations, no location or proof",
    !g.missing && g.rows.length === 1 && gk.includes("poster_confirmed_arrival_at") &&
      ["helper_arrival_near_miss_ft", "proof_before_urls", "helper_arrived_at"].every((k) => !gk.includes(k)),
    JSON.stringify(gk),
  );
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);

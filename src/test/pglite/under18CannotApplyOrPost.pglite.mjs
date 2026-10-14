#!/usr/bin/env node
/**
 * PGlite proof for 20261013010621_under_18_cannot_apply_or_post (docs/OPEN.md
 * Q1586(c), owner 2026-10-12: "Grey out the button until the age is 18 or over").
 *
 *   node src/test/pglite/under18CannotApplyOrPost.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/under18CannotApplyOrPost.pglite.mjs # RED: the live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture: scripts/probes/fixtures/applications.live.sql (applications as live,
 * roles real, auth.uid() reads request.uid), then apply_to_job as LIVE today:
 * the body cut verbatim from 20261006023437_crew_free_spot_relisted.sql, whose
 * md5(prosrc) equals prod's (e8fc9c7b442efa01468368c77968d503, read
 * 2026-10-12). Added, with only the columns these functions read: profiles
 * (user_id, date_of_birth), job_accept_pending (job_id, helper_id), and a
 * crew_spots_open stub (0: no crew here).
 *
 * Birthdays are computed from Louisiana's date in the database itself
 * ((now() AT TIME ZONE 'America/Chicago')::date), so the boundary rows are
 * exact on every day the proof runs.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const LIVE = read("../../../scripts/probes/fixtures/applications.live.sql");
const CREW = read("../../../supabase/migrations/20261006023437_crew_free_spot_relisted.sql");
const NEW = read("../../../supabase/migrations/20261013010621_under_18_cannot_apply_or_post.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const ADULT = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const MINOR = "5a1e0000-0000-4000-8000-000000000017";
const NODOB = "5a1e0000-0000-4000-8000-0000000000aa";
const TURNS_TODAY = "5a1e0000-0000-4000-8000-000000000018";
const TURNS_TOMORROW = "5a1e0000-0000-4000-8000-000000000019";
// Signed up with the 18+ box and no birthday, then types a real one under 18
// into Complete Profile (and, until 2026-10-14, the PhotoPrompt): the member's OWN
// profiles UPDATE, the exact write those screens send (owner 2026-10-13: saved,
// never refused; lh-authz-rls review of 0f7786627, must-fix 1).
const DISCLOSES = "5a1e0000-0000-4000-8000-0000000000d5";
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// apply_to_job exactly as live (the newest definition before this migration).
const start = CREW.indexOf("CREATE OR REPLACE FUNCTION public.apply_to_job");
const end = CREW.indexOf("$function$;", CREW.indexOf("$function$", start) + 10) + "$function$;".length;
const LIVE_APPLY = CREW.slice(start, end);

const db = new PGlite();
await db.exec(LIVE);
await db.exec(`
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, date_of_birth date);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
CREATE TABLE public.job_accept_pending (job_id uuid PRIMARY KEY, helper_id uuid NOT NULL, requested_at timestamptz DEFAULT now());
GRANT ALL ON public.job_accept_pending TO service_role;
CREATE FUNCTION public.crew_spots_open(p_job_id uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
GRANT INSERT (customer_id, status, payment_status) ON public.jobs TO authenticated;
ALTER TABLE public.jobs ADD COLUMN helper_confirmed_at timestamptz;
CREATE TABLE public.series_visit_holds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_job_id uuid, visit_date date, helper_id uuid, claimed_at timestamptz DEFAULT now());
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text, helper_confirmed_at timestamptz);
GRANT ALL ON public.series_visit_holds, public.group_job_helpers TO service_role;
-- Stand-ins for the member-called SECURITY DEFINER RPCs (respond_to_direct_offer
-- -> complete_direct_offer_accept, accept_job_offer, claim_series_dates,
-- accept_application): they write as the owner with the caller's auth.uid().
CREATE FUNCTION public.t_definer(p_sql text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN EXECUTE p_sql; END $$;
GRANT EXECUTE ON FUNCTION public.t_definer(text) TO authenticated;
`);
await db.exec(LIVE_APPLY);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

await db.exec(`
WITH t AS (SELECT (now() AT TIME ZONE 'America/Chicago')::date AS d)
INSERT INTO public.profiles (user_id, date_of_birth)
SELECT '${POSTER}'::uuid, DATE '1980-05-05' UNION ALL
SELECT '${ADULT}', DATE '1990-01-01' UNION ALL
SELECT '${MINOR}', (SELECT d FROM t) - interval '16 years' UNION ALL
SELECT '${NODOB}', NULL UNION ALL
SELECT '${TURNS_TODAY}', ((SELECT d FROM t) - interval '18 years')::date UNION ALL
SELECT '${TURNS_TOMORROW}', ((SELECT d FROM t) - interval '18 years' + interval '1 day')::date UNION ALL
SELECT '${DISCLOSES}', NULL;
INSERT INTO public.jobs (id, customer_id, status, payment_status)
SELECT ('10000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, '${POSTER}', 'open', 'escrow' FROM generate_series(1, 14) g;
`);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who && who !== "service" ? who : ""}', false);`);
  await db.exec(`SELECT set_config('request.jwt.claim.role', '${who === "service" ? "service_role" : who ? "authenticated" : "anon"}', false)`);
  await db.exec(who === "service" ? "SET ROLE service_role" : who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const apply = (who, job) => as(who, `SELECT public.apply_to_job('${job}', 'hi') AS id`);
const post = (who) => as(who, `INSERT INTO public.jobs (customer_id, status, payment_status) VALUES ('${who}', 'open', 'unpaid') RETURNING id`);
const refusedUnder18 = (r) => !r.ok && /under_18/.test(r.err);
const definer = (who, sql) => as(who, `SELECT public.t_definer($q$${sql}$q$)`);
const refusedUnavailable = (r) => !r.ok && /helper_unavailable/.test(r.err) && !/under_18/.test(r.err);

// ── apply_to_job ────────────────────────────────────────────────────────────
{
  const a = await apply(ADULT, id(1));
  check("A1 an adult still applies", a.ok && a.rows[0]?.id, a.ok ? "" : a.err);
  const n = await apply(NODOB, id(1));
  check("A2 a member with no birthday saved still applies (today's flow)", n.ok && n.rows[0]?.id, n.ok ? "" : n.err);
  const t = await apply(TURNS_TODAY, id(1));
  check("A3 a member whose 18th birthday is TODAY in Louisiana applies", t.ok && t.rows[0]?.id, t.ok ? "" : t.err);
  const m = await apply(MINOR, id(2));
  check("U1 a 16-year-old's apply_to_job is refused 'under_18'", refusedUnder18(m), m.ok ? "landed" : m.err);
  const tm = await apply(TURNS_TOMORROW, id(2));
  check("U2 a member who turns 18 TOMORROW is still refused", refusedUnder18(tm), tm.ok ? "landed" : tm.err);
}

// ── every other door into applications / job_accept_pending ────────────────
{
  const d = await definer(MINOR, `INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${id(3)}', '${MINOR}', 'accepted')`);
  check("U3 the minor accepting a direct offer (a definer applications INSERT) is refused 'under_18'", refusedUnder18(d), d.ok ? "landed" : d.err);
  const ds = await as("service", `INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${id(11)}', '${MINOR}', 'accepted') RETURNING id`);
  check("U3b a server completing it (no session) is refused 'helper_unavailable', never told the age", refusedUnavailable(ds), ds.ok ? "landed" : ds.err);
  const p = await definer(MINOR, `INSERT INTO public.job_accept_pending (job_id, helper_id) VALUES ('${id(4)}', '${MINOR}')`);
  check("U4 an under-18 Helpr's remembered offer 'yes' (job_accept_pending) is refused", refusedUnder18(p), p.ok ? "landed" : p.err);
  const pa = await as("service", `INSERT INTO public.job_accept_pending (job_id, helper_id) VALUES ('${id(5)}', '${ADULT}') RETURNING job_id`);
  check("A4 an adult's remembered offer 'yes' still lands", pa.ok && pa.rows.length === 1, pa.ok ? "" : pa.err);
  const h = await definer(MINOR, `INSERT INTO public.series_visit_holds (parent_job_id, visit_date, helper_id) VALUES ('${id(6)}', DATE '2030-01-01', '${MINOR}')`);
  check("U7 the minor holding a series date with no visit yet (claim_series_dates) is refused", refusedUnder18(h), h.ok ? "landed" : h.err);
  const ha = await definer(ADULT, `INSERT INTO public.series_visit_holds (parent_job_id, visit_date, helper_id) VALUES ('${id(6)}', DATE '2030-01-01', '${ADULT}')`);
  check("A9 an adult still holds a series date", ha.ok, ha.ok ? "" : ha.err);
  const g = await definer(POSTER, `INSERT INTO public.group_job_helpers (job_id, helper_id, status) VALUES ('${id(7)}', '${MINOR}', 'accepted')`);
  check("U8 the poster seating a minor on a crew is refused 'helper_unavailable' (the poster is not told the age)", refusedUnavailable(g), g.ok ? "landed" : g.err);
}

// ── a booking: helper_id set, or the Helpr's confirm ───────────────────────
{
  const hire = await definer(POSTER, `UPDATE public.jobs SET helper_id = '${MINOR}', status = 'accepted' WHERE id = '${id(8)}'`);
  check("U9 the poster hiring a minor (accept_application on an older application) is refused 'helper_unavailable'", refusedUnavailable(hire), hire.ok ? "landed" : hire.err);
  const hireA = await definer(POSTER, `UPDATE public.jobs SET helper_id = '${ADULT}', status = 'accepted' WHERE id = '${id(9)}'`);
  check("A10 the poster still hires an adult", hireA.ok, hireA.ok ? "" : hireA.err);
  // Booked before the birthday was saved (triggers off for the setup row only).
  await db.exec(`SET session_replication_role = replica; UPDATE public.jobs SET helper_id = '${MINOR}', status = 'accepted' WHERE id = '${id(10)}'; SET session_replication_role = origin;`);
  const conf = await definer(MINOR, `UPDATE public.jobs SET helper_confirmed_at = now() WHERE id = '${id(10)}'`);
  check("U10 the minor confirming a booking that predates the birthday (accept_job_offer) is refused 'under_18'", refusedUnder18(conf), conf.ok ? "landed" : conf.err);
  const other = await definer(POSTER, `UPDATE public.jobs SET payment_status = 'refunded' WHERE id = '${id(10)}'`);
  check("A11 any other update of that job (a refund, a cancel) is untouched", other.ok, other.ok ? "" : other.err);
  // A crew seat held before the birthday was saved: the first confirm is refused, other updates are not.
  await db.exec(`SET session_replication_role = replica; INSERT INTO public.group_job_helpers (id, job_id, helper_id, status) VALUES ('${id(20)}', '${id(12)}', '${MINOR}', 'accepted'), ('${id(21)}', '${id(12)}', '${ADULT}', 'accepted'); SET session_replication_role = origin;`);
  const crew = await definer(MINOR, `UPDATE public.group_job_helpers SET helper_confirmed_at = now() WHERE id = '${id(20)}'`);
  check("U11 the minor's first confirm of a crew seat that predates the birthday is refused 'under_18'", refusedUnder18(crew), crew.ok ? "landed" : crew.err);
  const crewA = await definer(ADULT, `UPDATE public.group_job_helpers SET helper_confirmed_at = now() WHERE id = '${id(21)}'`);
  check("A12 an adult still confirms a crew seat", crewA.ok, crewA.ok ? "" : crewA.err);
  const crewOther = await definer(POSTER, `UPDATE public.group_job_helpers SET status = 'removed' WHERE id = '${id(20)}'`);
  check("A13 any other update of the minor's seat (the poster removing it) is untouched", crewOther.ok, crewOther.ok ? "" : crewOther.err);
}

// ── posting a job ───────────────────────────────────────────────────────────
{
  const m = await post(MINOR);
  check("U5 a 16-year-old posting their own job is refused 'under_18'", refusedUnder18(m), m.ok ? "landed" : m.err);
  const tm = await post(TURNS_TOMORROW);
  check("U6 ...and so is a member who turns 18 tomorrow", refusedUnder18(tm), tm.ok ? "landed" : tm.err);
  const a = await post(ADULT);
  check("A5 an adult still posts", a.ok && a.rows.length === 1, a.ok ? "" : a.err);
  const n = await post(NODOB);
  check("A6 a member with no birthday saved still posts", n.ok && n.rows.length === 1, n.ok ? "" : n.err);
  const t = await post(TURNS_TODAY);
  check("A7 a member who turns 18 today posts", t.ok && t.rows.length === 1, t.ok ? "" : t.err);
  const s = await as("service", `INSERT INTO public.jobs (customer_id, status, payment_status) VALUES ('${MINOR}', 'accepted', 'escrow') RETURNING id`);
  check("A8 a server writer with no member session (the next visit of an existing series) is not a new post", s.ok && s.rows.length === 1, s.ok ? "" : s.err);
}

// ── the saved birthday cannot be rewritten by the minor ─────────────────────
{
  const up = await as(MINOR, `UPDATE public.profiles SET date_of_birth = DATE '1990-01-01' WHERE user_id = '${MINOR}' RETURNING id`);
  check("L1 a member under 18 cannot rewrite their saved birthday to an adult one", !up.ok && /under_18_birthday_locked/.test(up.err), up.ok ? "rewritten" : up.err);
  const clr = await as(MINOR, `UPDATE public.profiles SET date_of_birth = NULL WHERE user_id = '${MINOR}' RETURNING id`);
  check("L2 ...nor clear it (then type a new one)", !clr.ok && /under_18_birthday_locked/.test(clr.err), clr.ok ? "cleared" : clr.err);
  const same = await as(MINOR, `UPDATE public.profiles SET date_of_birth = date_of_birth WHERE user_id = '${MINOR}' RETURNING id`);
  check("L3 a Profile save that writes the same birthday back still saves", same.ok && same.rows.length === 1, same.ok ? "" : same.err);
  const adult = await as(ADULT, `UPDATE public.profiles SET date_of_birth = DATE '1991-02-02' WHERE user_id = '${ADULT}' RETURNING id`);
  check("L4 an adult's own birthday edit is untouched", adult.ok && adult.rows.length === 1, adult.ok ? "" : adult.err);
  const svc = await as("service", `UPDATE public.profiles SET date_of_birth = DATE '1999-09-09' WHERE user_id = '${TURNS_TOMORROW}' RETURNING id`);
  check("L5 support (a server path) can still correct a minor's birthday", svc.ok && svc.rows.length === 1, svc.ok ? "" : svc.err);
}

// ── a typed under-18 birthday is saved through the member's own write ───
{
  const before = await apply(DISCLOSES, id(13));
  check("S0 before telling us, the 18+ box is enough: the member applies", before.ok && before.rows[0]?.id, before.ok ? "" : before.err);
  const save = await as(DISCLOSES, `UPDATE public.profiles SET date_of_birth = ((now() AT TIME ZONE 'America/Chicago')::date - interval '16 years')::date WHERE user_id = auth.uid() RETURNING id`);
  check("S1 the member's own save of an under-18 birthday lands (CompleteProfile's write; never refused)", save.ok && save.rows.length === 1, save.ok ? `${save.rows.length} row(s)` : save.err);
  const after = await apply(DISCLOSES, id(14));
  check("S2 ...and from that moment apply_to_job refuses them 'under_18'", refusedUnder18(after), after.ok ? "landed" : after.err);
  const p = await post(DISCLOSES);
  check("S3 ...and posting a job is refused 'under_18'", refusedUnder18(p), p.ok ? "landed" : p.err);
  const undo = await as(DISCLOSES, `UPDATE public.profiles SET date_of_birth = NULL WHERE user_id = auth.uid() RETURNING id`);
  check("S4 ...and they cannot take it back to get the box's pass again", !undo.ok && /under_18_birthday_locked/.test(undo.err), undo.ok ? "cleared" : undo.err);
}

// ── the helper does not leak anyone's age ───────────────────────────────────
{
  const r = await as(ADULT, `SELECT public.member_under_18('${MINOR}') AS u`);
  check("G1 member_under_18 is not callable by a member (it would tell anyone another member's age)", !r.ok && /permission denied|does not exist/i.test(r.err), r.ok ? `returned ${r.rows[0]?.u}` : r.err);
  const anon = await as(null, `SELECT public.member_under_18('${MINOR}') AS u`);
  check("G2 ...nor by anon", !anon.ok, anon.ok ? `returned ${anon.rows[0]?.u}` : anon.err);
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);

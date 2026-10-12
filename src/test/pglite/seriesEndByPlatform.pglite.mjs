#!/usr/bin/env node
/**
 * PGlite proof for 20261012194707_series_end_by_platform (Q417 c, d).
 *
 *   node src/test/pglite/seriesEndByPlatform.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/seriesEndByPlatform.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). Fixture: the columns and tables the two new
 * functions read and write (jobs, series_visit_holds, notifications,
 * admin_audit_log, has_role). On main neither function exists, so nobody but
 * a party can end a series and a chargeback ends nothing.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = readFileSync(`${MIG}20261012194707_series_end_by_platform.sql`, "utf8");
/** A function as the newest migration defines it (prod's body, md5-checked 2026-10-12). */
function newestFn(name) {
  let out = null;
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(MIG + f, "utf8");
    const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
    if (!m) continue;
    const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
    const close = sql.indexOf(open[1], m.index + open.index + open[0].length);
    out = sql.slice(m.index, sql.indexOf(";", close) + 1);
  }
  return out;
}
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const ADMIN_POSTER = "00000000-0000-0000-0000-0000000000a2";
const USER = "00000000-0000-0000-0000-0000000000b1";
const POSTER = "00000000-0000-0000-0000-0000000000c1";
const H1 = "00000000-0000-0000-0000-0000000000d1";
const H2 = "00000000-0000-0000-0000-0000000000d2";
const SERIES = "10000000-0000-0000-0000-000000000001";
const VISIT = "10000000-0000-0000-0000-000000000002";
const ONE_OFF = "10000000-0000-0000-0000-000000000003";
const SERIES2 = "10000000-0000-0000-0000-000000000004";

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE public.user_roles(user_id uuid, role text);
  CREATE FUNCTION public.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql STABLE
    AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = u AND role = r) $$;
  CREATE TABLE public.jobs(id uuid PRIMARY KEY, title text, customer_id uuid, recurring_helper_id uuid, helper_id uuid,
    recurrence_days int[], parent_job_id uuid, date_needed date, series_ended_on date, status text,
    recurrence_weeks int, start_time time, recurrence_end_date date, series_split_ok boolean);
  CREATE TABLE public.series_visit_holds(parent_job_id uuid, helper_id uuid, visit_date date);
  CREATE TABLE public.series_date_offers(parent_job_id uuid, helper_id uuid);
  CREATE FUNCTION public.job_has_crew(j uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  GRANT USAGE ON SCHEMA public TO authenticated; GRANT USAGE ON SCHEMA auth TO authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
  GRANT SELECT, UPDATE ON public.jobs TO authenticated;
  CREATE TABLE public.notifications(user_id uuid, job_id uuid, title text, message text, type text, link text);
  CREATE TABLE public.admin_audit_log(admin_id uuid, action text, target_type text, target_id text, details jsonb);
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin'), ('${ADMIN_POSTER}', 'admin');
`);
// Prod's own gates on the column: the series client lock (verbatim) and is_series_party.
await db.exec(newestFn("is_series_party"));
await db.exec(newestFn("enforce_series_columns_client_lock"));
await db.exec(`CREATE TRIGGER trg_enforce_series_columns_client_lock
  BEFORE INSERT OR UPDATE OF parent_job_id, recurrence_days, recurrence_weeks, date_needed, start_time, recurrence_end_date, series_ended_on, series_split_ok ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_series_columns_client_lock();`);
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);

const today = `(now() AT TIME ZONE 'America/Chicago')::date`;
async function seed() {
  await db.exec(`
    DELETE FROM public.jobs; DELETE FROM public.series_visit_holds; DELETE FROM public.notifications; DELETE FROM public.admin_audit_log;
    INSERT INTO public.jobs VALUES
      ('${SERIES}', 'Weekly lawn', '${POSTER}', '${H1}', '${H1}', ARRAY[1,3], NULL, ${today} - 7, NULL, 'completed'),
      ('${VISIT}', 'Weekly lawn', '${POSTER}', NULL, '${H1}', NULL, '${SERIES}', ${today} + 2, NULL, 'accepted'),
      ('${ONE_OFF}', 'Fence', '${POSTER}', NULL, NULL, NULL, NULL, ${today} + 2, NULL, 'open'),
      ('${SERIES2}', 'Pool', '${ADMIN_POSTER}', NULL, NULL, ARRAY[2], NULL, ${today} + 1, NULL, 'open');
    DELETE FROM public.series_date_offers;
    INSERT INTO public.series_visit_holds VALUES ('${SERIES}', '${H1}', ${today} + 2), ('${SERIES}', '${H2}', ${today} + 9);
  `);
}
async function as(uid, sql) {
  await db.exec(`SELECT set_config('test.uid', '${uid}', false)`);
  try {
    const r = await db.query(sql);
    return { ok: true, row: r.rows[0] };
  } catch (e) {
    return { ok: false, err: String(e.message) };
  }
}
const platform = (job, kind = "chargeback") => `SELECT public.end_recurring_series_by_platform('${job}', '${kind}', 'Stripe dispute dp_1') AS r`;
const adminEnd = (job, reason = "poster asked support to stop it, confirmed by phone") => `SELECT public.rpc_admin_end_recurring_series('${job}', '${reason}') AS r`;
const notes = async () => (await db.query(`SELECT user_id, message, link FROM public.notifications ORDER BY user_id`)).rows;

// ── (d) a chargeback on a VISIT ends its series and tells both sides ─────────
await seed();
let r = await as("", platform(VISIT));
check("chargeback on a visit: the series ends", r.ok && r.row.r.action === "ended", r.ok ? JSON.stringify(r.row.r) : r.err);
const ended = (await db.query(`SELECT series_ended_on FROM public.jobs WHERE id = '${SERIES}'`)).rows[0]?.series_ended_on;
check("  series_ended_on is set on the PARENT", ended != null, String(ended));
let n = await notes();
check("  both Helprs on the series are told, in neutral words", [H1, H2].every((h) => n.some((x) => x.user_id === h && /^Louisiana Helpr ended the recurring series/.test(x.message) && !/disputed/.test(x.message))), JSON.stringify(n.map((x) => x.user_id)));
check("  the poster is told why, and that a paid unbooked visit is refunded less the card fee", n.some((x) => x.user_id === POSTER && /disputed with your bank/.test(x.message) && /refunded, less the card processing fee/.test(x.message) && x.link === `/posts?job=${SERIES}`));
check("  the booked visit is named as still going ahead", n.some((x) => /1 visit already booked still goes ahead/.test(x.message)));
r = await as("", platform(VISIT));
check("a second delivery: already_ended, nobody told twice", r.ok && r.row.r.action === "already_ended" && (await notes()).length === n.length, r.ok ? JSON.stringify(r.row.r) : r.err);
r = await as("", platform(ONE_OFF));
check("a one-off job is not a series", !r.ok && /not_a_series/.test(r.err), r.err);
r = await as("", `SELECT public.end_recurring_series_by_platform('${VISIT}', 'whim', 'x y z') AS r`);
check("an unknown kind is refused", !r.ok && /end_series_unknown_kind/.test(r.err), r.err);

// ── (c) an admin ends a series ──────────────────────────────────────────────
await seed();
r = await as(USER, adminEnd(SERIES));
check("a non-admin cannot end a series", !r.ok && /admin only/.test(r.err), r.err);
r = await as("", adminEnd(SERIES));
check("signed out cannot end a series", !r.ok && /not authenticated/.test(r.err), r.err);
r = await as(ADMIN, adminEnd(SERIES, "short"));
check("a short reason is refused", !r.ok && /end_series_needs_reason/.test(r.err), r.err);
r = await as(ADMIN_POSTER, adminEnd(SERIES2));
check("an admin who is a party (the poster) is refused", !r.ok && /admin_is_party/.test(r.err), r.err);
await db.exec(`INSERT INTO public.series_date_offers VALUES ('${SERIES}', '${ADMIN}')`);
r = await as(ADMIN, adminEnd(SERIES));
check("an admin holding an offered date on the series is refused", !r.ok && /admin_is_party/.test(r.err), r.err);
await db.exec(`DELETE FROM public.series_date_offers`);
await db.exec(`SET ROLE authenticated`);
r = await as(USER, `UPDATE public.jobs SET series_ended_on = ${today} WHERE id = '${SERIES}' RETURNING id`);
check("a plain client UPDATE of series_ended_on is refused by the series lock", !r.ok && /series_locked/.test(r.err), r.ok ? "updated" : r.err);
r = await as(ADMIN, adminEnd(SERIES));
await db.exec(`RESET ROLE`);
check("an admin ends the series as a signed-in client (the write passes the series lock)", r.ok && r.row.r.action === "ended", r.ok ? JSON.stringify(r.row.r) : r.err);
const audit = (await db.query(`SELECT admin_id, details FROM public.admin_audit_log WHERE action = 'end_recurring_series'`)).rows;
check("  one audit row with the reason", audit.length === 1 && audit[0].admin_id === ADMIN && /confirmed by phone/.test(audit[0].details.reason), JSON.stringify(audit));
n = await notes();
check("  the poster reads that Louisiana Helpr ended it", n.some((x) => x.user_id === POSTER && /^Louisiana Helpr ended your recurring series/.test(x.message)));

// ── Grants ──────────────────────────────────────────────────────────────────
if (!MODE) {
  const priv = async (role, sig) => (await db.query(`SELECT has_function_privilege('${role}', '${sig}', 'EXECUTE') x`)).rows[0].x;
  const P = "public.end_recurring_series_by_platform(uuid, text, text, uuid)";
  const A = "public.rpc_admin_end_recurring_series(uuid, text)";
  check("the platform end is service_role only", !(await priv("anon", P)) && !(await priv("authenticated", P)) && (await priv("service_role", P)));
  check("the admin RPC: authenticated yes (admin-gated inside), anon no", (await priv("authenticated", A)) && !(await priv("anon", A)));
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);

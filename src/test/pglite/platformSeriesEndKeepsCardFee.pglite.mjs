#!/usr/bin/env node
/**
 * PGlite proof for 20261014084428_platform_series_end_keeps_card_fee (owner
 * decision 2026-10-14: "we should never absorb any fee"). A series the
 * PLATFORM ends now tells its poster that a paid, unbooked visit is refunded
 * LESS the card processing fee (it said "in full" under Q1735); the refund
 * half is proven in src/test/edge/charge-recurring-visits.test.ts.
 * Base: 20261012194707 + 20261012233226 (the state on main).
 *
 *   node src/test/pglite/platformSeriesEndKeepsCardFee.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/platformSeriesEndKeepsCardFee.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = readFileSync(`${MIG}20261012194707_series_end_by_platform.sql`, "utf8");
const IN_FULL = readFileSync(`${MIG}20261012233226_platform_series_end_refunds_in_full.sql`, "utf8");
const NEW = readFileSync(`${MIG}20261014084428_platform_series_end_keeps_card_fee.sql`, "utf8");
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
await db.exec(BASE);
await db.exec(IN_FULL);
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);

const today = `(now() AT TIME ZONE 'America/Chicago')::date`;
await db.exec(`
  INSERT INTO public.jobs (id, title, customer_id, recurring_helper_id, helper_id, recurrence_days, parent_job_id, date_needed, series_ended_on, status) VALUES
    ('${SERIES2}', 'Pool', '${ADMIN_POSTER}', NULL, NULL, ARRAY[2], NULL, ${today} + 1, NULL, 'open'),
    ('${SERIES}', 'Weekly lawn', '${POSTER}', '${H1}', '${H1}', ARRAY[1,3], NULL, ${today} - 7, NULL, 'completed'),
    ('${VISIT}', 'Weekly lawn', '${POSTER}', NULL, '${H1}', NULL, '${SERIES}', ${today} + 2, NULL, 'accepted');
`);
await db.exec(`SELECT set_config('test.uid', '${ADMIN}', false)`);
await db.query(`SELECT public.rpc_admin_end_recurring_series('${SERIES2}', 'the poster asked support to stop it')`);
const an = (await db.query(`SELECT message FROM public.notifications WHERE user_id = '${ADMIN_POSTER}'`)).rows.map((r) => r.message);
check("an ADMIN end tells its poster a paid unbooked visit is refunded LESS the card processing fee", an.some((m) => /is refunded, less the card processing fee\. Questions/.test(m)), JSON.stringify(an));
check("  and never says \"refunded in full\"", !an.some((m) => /refunded in full/.test(m)), JSON.stringify(an));
await db.exec(`SELECT set_config('test.uid', '', false)`);
await db.query(`SELECT public.end_recurring_series_by_platform('${VISIT}', 'chargeback', 'Stripe dispute dp_1')`);
const pn = (await db.query(`SELECT message FROM public.notifications WHERE user_id = '${POSTER}'`)).rows.map((r) => r.message);
check("a CHARGEBACK end still says the card fee is kept (unchanged)", pn.some((m) => /refunded, less the card processing fee\./.test(m)), JSON.stringify(pn));
const e = (await db.query(`SELECT parent_job_id, end_kind FROM public.series_platform_ends`)).rows;
check("the admin-end record is still written, once", e.length === 1 && e[0].parent_job_id === SERIES2, JSON.stringify(e));
const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'end_recurring_series_by_platform'`)).rows[0].a ?? "";
check("grants restated: service_role may execute, anon and authenticated may not", /service_role=X/.test(acl) && !/(^|[{,])anon=/.test(acl) && !/(^|[{,])authenticated=/.test(acl) && !/(^|[{,])=X/.test(acl), acl);

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
